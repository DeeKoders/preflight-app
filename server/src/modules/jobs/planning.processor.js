'use strict';

const { UnrecoverableError } = require('bullmq');
const env = require('../../config/env');
const logger = require('../../lib/logger');
const { sequelize, PlanningJob, DevelopmentPlan, Ticket, AIProviderSetting } = require('../../db');
const { IntegrationError } = require('../../lib/errors');
const jiraService = require('../jira/jira.service');
const githubService = require('../github/github.service');
const aiService = require('../ai/ai.service');
const { describeProviders } = require('../ai/providers');
const { estimateCost } = require('../ai/pricing');
const { runPlanningAgent } = require('../agent/orchestrator');
const { ProgressTracker } = require('../agent/progress');
const { renderPlanMarkdown } = require('../agent/markdown');

const PERSIST_INTERVAL_MS = 750;

const agentLimits = () => ({
  maxIterations: env.AGENT_MAX_ITERATIONS,
  maxToolCalls: env.AGENT_MAX_TOOL_CALLS,
  timeoutMs: env.AGENT_TIMEOUT_MS,
  maxTotalTokens: env.AGENT_MAX_TOTAL_TOKENS,
  maxOutputTokens: env.AGENT_MAX_OUTPUT_TOKENS,
  maxPlanRepairs: env.AGENT_MAX_PLAN_REPAIRS,
});

/** Assigns the next version number for a ticket, or reuses the row from a previous attempt. */
async function claimPlanRow(job, setting, repository) {
  if (job.planId) {
    const existing = await DevelopmentPlan.findByPk(job.planId);
    if (existing && existing.generationStatus !== 'completed') {
      await existing.update({ generationStatus: 'generating', errorDetails: null, aiProvider: setting.provider, aiModel: setting.model, repository });
      return existing;
    }
  }
  return sequelize.transaction(async (transaction) => {
    // Lock the ticket row so concurrent runs cannot race on version numbers.
    await Ticket.findByPk(job.ticketId, { lock: transaction.LOCK.UPDATE, transaction });
    const max = (await DevelopmentPlan.max('version', { where: { ticketId: job.ticketId }, transaction })) || 0;
    const plan = await DevelopmentPlan.create(
      {
        userId: job.userId,
        ticketId: job.ticketId,
        version: max + 1,
        aiProvider: setting.provider,
        aiModel: setting.model,
        repository,
        generationStatus: 'generating',
      },
      { transaction }
    );
    await job.update({ planId: plan.id }, { transaction });
    return plan;
  });
}

function safeErrorDetails(err, stage) {
  return {
    code: err.code || 'PLANNING_FAILED',
    message: err.expose || err instanceof IntegrationError ? err.message : 'An unexpected error occurred while generating the plan.',
    service: err.service || null,
    stage: stage || null,
    at: new Date().toISOString(),
  };
}

async function processPlanningJob(bullJob) {
  const { planningJobId } = bullJob.data;
  const job = await PlanningJob.findByPk(planningJobId, { include: [{ model: Ticket, as: 'ticket' }] });
  if (!job) throw new UnrecoverableError('Planning job no longer exists');
  if (['completed', 'cancelled', 'failed'].includes(job.status)) return { skipped: true };

  const attempt = bullJob.attemptsMade + 1;
  const maxAttempts = bullJob.opts.attempts || 1;
  const log = logger.child({ planningJobId, userId: job.userId, attempt });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.AGENT_TIMEOUT_MS);

  let lastPersist = 0;
  let pending = null;
  let cancelled = false;
  const persist = async (state, force = false) => {
    pending = state;
    const now = Date.now();
    if (!force && now - lastPersist < PERSIST_INTERVAL_MS) return;
    lastPersist = now;
    const snapshot = pending;
    pending = null;
    await PlanningJob.update({ progressMetadata: snapshot, currentStage: snapshot.current }, { where: { id: job.id, status: 'running' } });
    // Cooperative cancellation: the user may cancel while the agent runs.
    const fresh = await PlanningJob.findByPk(job.id, { attributes: ['status'] });
    if (fresh?.status === 'cancelled' && !cancelled) {
      cancelled = true;
      controller.abort();
    }
  };
  // Each attempt starts with fresh stages; the activity log is carried over across retries.
  const tracker = new ProgressTracker((state) => persist(state));
  if (Array.isArray(job.progressMetadata?.events)) tracker.state.events = job.progressMetadata.events;

  await job.update({ status: 'running', startedAt: job.startedAt || new Date(), attempts: attempt, errorMessage: null });
  if (attempt > 1) await tracker.event(`Retry attempt ${attempt} of ${maxAttempts}`, 'warn');

  let plan;
  try {
    // The provider is the one chosen when the job was created — never substituted.
    const setting = await AIProviderSetting.findOne({ where: { id: job.options.aiSettingId, userId: job.userId } });
    if (!setting) throw Object.assign(new Error('The AI provider configured for this job was removed. Configure it again and regenerate.'), { code: 'AI_NOT_CONFIGURED', expose: true });
    const { adapter } = await aiService.resolveForPlanning(job.userId, setting.id);
    const { client: jiraClient, integration } = await jiraService.getClient(job.userId);

    let github = null;
    if (job.options.repository) {
      await githubService.assertSelectedRepository(job.userId, job.options.repository);
      const { client } = await githubService.getClient(job.userId);
      const repo = await client.getRepo(job.options.repository);
      github = { client, repo: repo.full_name, ref: repo.default_branch };
    }

    plan = await claimPlanRow(job, setting, github?.repo || null);
    const costs = [];
    const result = await runPlanningAgent({
      ticketKey: job.ticket.jiraIssueKey,
      adapter,
      model: setting.model,
      jira: { client: jiraClient, siteUrl: integration.siteUrl },
      github,
      limits: agentLimits(),
      tracker,
      signal: controller.signal,
      onUsage: async (usage, operation) => {
        costs.push(await aiService.recordUsage({ userId: job.userId, provider: setting.provider, model: setting.model, ticketId: job.ticketId, planningJobId: job.id, operation, usage }));
      },
    });

    const latest = await PlanningJob.findByPk(job.id, { attributes: ['status'] });
    if (latest?.status === 'cancelled') {
      cancelled = true;
      throw new Error('Cancelled by user');
    }
    await tracker.start('save_plan');
    const providerLabel = describeProviders().find((p) => p.id === setting.provider)?.label || setting.provider;
    const generatedAt = new Date();
    const markdown = renderPlanMarkdown(result.plan, {
      ticket: result.ticket,
      meta: { generatedAt, providerLabel, model: setting.model, version: plan.version, repository: github?.repo || null, ref: github?.ref || null },
    });
    const estimatedCostUsd = costs.some((c) => c === null) ? null : estimateCost(setting.provider, setting.model, result.usage);

    await sequelize.transaction(async (transaction) => {
      await plan.update(
        {
          markdownContent: markdown,
          structuredContent: result.plan,
          sourceContextHash: result.contextHash,
          sourceJiraUpdatedAt: result.ticket.updated,
          generationStatus: 'completed',
          tokenUsage: { ...result.usage, estimatedCostUsd },
          generationDurationMs: result.stats.durationMs,
          agentTrace: {
            stats: result.stats,
            toolCalls: result.trace,
            investigationSummary: result.investigationSummary,
            verificationNotes: result.verificationNotes,
          },
          errorDetails: null,
        },
        { transaction }
      );
      await Ticket.update(
        {
          summary: result.ticket.summary,
          status: result.ticket.status,
          statusCategory: result.ticket.statusCategory,
          priority: result.ticket.priority,
          issueType: result.ticket.issueType,
          jiraUpdatedAt: result.ticket.updated,
          lastSyncedAt: new Date(),
        },
        { where: { id: job.ticketId }, transaction }
      );
      tracker.stage('save_plan').status = 'done';
      tracker.stage('save_plan').finishedAt = new Date().toISOString();
      await job.update(
        { status: 'completed', currentStage: 'save_plan', completedAt: new Date(), progressMetadata: tracker.state, errorMessage: null },
        { transaction }
      );
    });
    log.info({ planId: plan.id, version: plan.version, ...result.stats }, 'Development plan generated');
    return { planId: plan.id, version: plan.version };
  } catch (err) {
    if (cancelled) {
      await tracker.fail('Cancelled by user');
      await persist(tracker.state, true).catch(() => {});
      if (plan) await plan.update({ generationStatus: 'failed', errorDetails: { code: 'CANCELLED', message: 'Cancelled by user', at: new Date().toISOString() } });
      await PlanningJob.update({ completedAt: new Date(), progressMetadata: tracker.state }, { where: { id: job.id } });
      throw new UnrecoverableError('Cancelled by user');
    }
    const retryable = Boolean(err.retryable) && attempt < maxAttempts;
    const stage = tracker.state.current;
    log.warn({ code: err.code, retryable, stage, err: err.expose ? undefined : err }, `Planning attempt failed: ${err.message}`);
    if (retryable) {
      await tracker.event(`Attempt ${attempt} failed (${err.message}). Retrying with backoff…`, 'warn');
      await PlanningJob.update(
        { status: 'queued', errorMessage: `Retrying: ${safeErrorDetails(err, stage).message}`, progressMetadata: tracker.state },
        { where: { id: job.id } }
      );
      if (plan) await plan.update({ generationStatus: 'generating', errorDetails: safeErrorDetails(err, stage) });
      throw err;
    }
    const details = safeErrorDetails(err, stage);
    await tracker.fail(details.message);
    await PlanningJob.update(
      { status: 'failed', errorMessage: details.message, completedAt: new Date(), progressMetadata: tracker.state },
      { where: { id: job.id } }
    );
    if (plan) await plan.update({ generationStatus: 'failed', errorDetails: details, generationDurationMs: Date.now() - new Date(job.startedAt).getTime() });
    throw new UnrecoverableError(details.message);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { processPlanningJob, agentLimits };
