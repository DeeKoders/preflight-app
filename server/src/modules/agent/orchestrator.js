'use strict';

const { IntegrationError, AppError } = require('../../lib/errors');
const { normalizeIssueDetail, normalizeComment } = require('../jira/jira.normalize');
const { SYSTEM_PROMPT, buildKickoffMessage, SYNTHESIS_INSTRUCTION, repairInstruction, TRUNCATED_INSTRUCTION } = require('./prompts');
const { buildToolset, executeTool } = require('./tools');
const { validatePlan } = require('./planSchema');
const { verifyPlanEvidence } = require('./evidence');
const { computeContextHash } = require('./context');
const { wrapUntrusted } = require('./untrusted');

const SUBMIT = 'submit_development_plan';
const FINISH = 'finish_investigation';
const MAX_CONTEXT_CHARS = 350_000; // bound on total tool output fed to the model
const INVESTIGATION_MAX_OUTPUT = 8_000;

class AgentError extends AppError {
  constructor(code, message, { retryable = false } = {}) {
    super(422, code, message);
    this.name = 'AgentError';
    this.retryable = retryable;
  }
}

function addUsage(total, u) {
  total.inputTokens += u.inputTokens || 0;
  total.outputTokens += u.outputTokens || 0;
  total.cacheReadTokens += u.cacheReadTokens || 0;
  total.cacheWriteTokens += u.cacheWriteTokens || 0;
  total.totalTokens = total.inputTokens + total.outputTokens + total.cacheReadTokens + total.cacheWriteTokens;
  total.requests += 1;
}

/**
 * Runs the read-only planning agent for one Jira ticket.
 *
 * Phase 0 (deterministic): fetch the ticket + comments.
 * Phase 1 (investigation): the model decides which read-only tools to call,
 *   bounded by iteration, tool-call, context, token and time limits.
 * Phase 2 (synthesis): the model submits the plan through a strict schema;
 *   invalid / truncated output is repaired a bounded number of times.
 * Phase 3: grounding verification of code paths, links and confidence.
 */
async function runPlanningAgent({ ticketKey, adapter, model, jira, github, limits, tracker, onUsage = async () => {}, signal }) {
  const startedAt = Date.now();
  const observed = { issueKeys: new Set(), filePaths: new Set(), seenPaths: new Set(), urls: new Set() };
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, requests: 0 };
  const trace = [];
  const checkAbort = () => {
    if (signal?.aborted) throw new AgentError('AGENT_TIMEOUT', `Planning exceeded the time limit of ${Math.round(limits.timeoutMs / 1000)}s and was stopped.`);
  };

  // ---- Phase 0: ticket understanding (deterministic fetch) -------------------
  await tracker.start('fetch_ticket');
  const rawIssue = await jira.client.getIssue(ticketKey);
  const ticket = normalizeIssueDetail(rawIssue, jira.siteUrl);
  const commentsRes = await jira.client.getComments(ticket.key, { maxResults: 50 }).catch(() => ({ comments: [] }));
  const comments = (commentsRes.comments || []).map(normalizeComment);
  observed.issueKeys.add(ticket.key);
  [ticket.parent, ...ticket.subtasks, ...ticket.issueLinks].filter(Boolean).forEach((i) => observed.issueKeys.add(i.key));
  const contextHash = computeContextHash(ticket, comments);
  trace.push({ tool: 'get_ticket_details', args: JSON.stringify({ issueKey: ticket.key }), ok: true, summary: 'Initial ticket fetch', durationMs: 0 });
  await tracker.complete('fetch_ticket', `${ticket.key} · ${comments.length} comment(s) · ${ticket.issueLinks.length} link(s)`);

  const githubAvailable = Boolean(github);
  const toolset = buildToolset({ githubAvailable });
  const ctx = { jira, github: github ? { ...github, tree: null } : null, observed, ticketKey: ticket.key };

  const ticketBlock = wrapUntrusted(`jira:${ticket.key}`, { ...ticket, commentCount: comments.length }, 40_000).text;
  const commentsBlock = comments.length
    ? wrapUntrusted(`jira:${ticket.key}/comments`, comments.slice(0, 30), 30_000).text
    : 'No comments on this ticket.';
  const messages = [
    {
      role: 'user',
      content: buildKickoffMessage({
        ticketBlock,
        commentsBlock,
        githubAvailable,
        repository: github?.repo,
        toolNames: toolset.investigationDefinitions.map((d) => d.name),
      }),
    },
  ];

  let phase = 'investigate';
  let iterations = 0;
  let toolCalls = 0;
  let repairs = 0;
  let nudges = 0;
  let contextChars = 0;
  let investigationSummary = null;
  let finalPlan = null;
  const usedCategories = new Set();

  const enterSynthesis = async (reason) => {
    phase = 'synthesize';
    await tracker.complete('understand_requirements');
    if (usedCategories.has('jira')) await tracker.complete('investigate_jira');
    else await tracker.skip('investigate_jira', 'No additional Jira context was needed');
    if (!githubAvailable) await tracker.skip('explore_codebase', 'Codebase analysis unavailable — no GitHub repository selected');
    else if (usedCategories.has('github')) await tracker.complete('explore_codebase', `${observed.filePaths.size} file(s) read`);
    else await tracker.skip('explore_codebase', 'Agent did not inspect the repository');
    if (reason) await tracker.event(reason, 'warn');
    await tracker.start('draft_plan');
  };

  await tracker.start('understand_requirements');

  while (!finalPlan) {
    checkAbort();
    iterations += 1;
    if (iterations > limits.maxIterations) {
      throw new AgentError('AGENT_ITERATION_LIMIT', `The agent reached the maximum of ${limits.maxIterations} iterations without producing a valid plan.`);
    }
    if (phase === 'investigate') {
      const reserved = limits.maxPlanRepairs + 1;
      if (iterations > limits.maxIterations - reserved || usage.totalTokens > limits.maxTotalTokens * 0.7) {
        await enterSynthesis('Investigation budget reached; moving on to drafting the plan.');
        messages.push({ role: 'user', content: `Investigation budget reached. ${SYNTHESIS_INSTRUCTION}` });
      }
    }
    if (usage.totalTokens > limits.maxTotalTokens) {
      throw new AgentError('AGENT_TOKEN_LIMIT', `The run exceeded the token budget of ${limits.maxTotalTokens.toLocaleString()} tokens.`);
    }

    const synthesizing = phase === 'synthesize';
    const turn = await adapter.executeAgentTurn({
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools: synthesizing ? toolset.submitDefinitions : toolset.investigationDefinitions,
      toolChoice: synthesizing ? { name: SUBMIT } : 'auto',
      maxOutputTokens: synthesizing ? limits.maxOutputTokens : Math.min(limits.maxOutputTokens, INVESTIGATION_MAX_OUTPUT),
      signal,
    });
    addUsage(usage, turn.usage);
    await onUsage(turn.usage, synthesizing ? 'plan_synthesis' : 'agent_investigation');
    messages.push({ role: 'assistant', content: turn.text || '', toolCalls: turn.toolCalls, raw: turn.raw });

    if (turn.stopReason === 'refusal') {
      throw new AgentError('AI_REFUSAL', 'The AI provider declined to process this ticket (safety refusal). Review the ticket content or try a different model.');
    }

    if (phase === 'investigate') {
      if (iterations === 1) await tracker.complete('understand_requirements');
      if (!turn.toolCalls.length) {
        nudges += 1;
        if (nudges > 2) {
          await enterSynthesis('Agent stopped calling tools; drafting the plan.');
          messages.push({ role: 'user', content: SYNTHESIS_INSTRUCTION });
        } else {
          messages.push({ role: 'user', content: 'Continue the investigation using the tools, or call finish_investigation when you have enough context. Do not write the plan as plain text.' });
        }
        continue;
      }

      const results = [];
      let finished = false;
      const runnable = [];
      for (const call of turn.toolCalls) {
        if (call.name === FINISH) {
          finished = true;
          investigationSummary = call.arguments?.summary || null;
          results.push({ toolCallId: call.id, name: call.name, content: 'Acknowledged. Investigation finished.', isError: false });
        } else if (call.name === SUBMIT) {
          // The model jumped ahead; accept a valid plan directly.
          const v = validatePlan(call.arguments);
          if (v.success) {
            finalPlan = v.data;
            results.push({ toolCallId: call.id, name: call.name, content: 'Plan received.', isError: false });
          } else {
            finished = true;
            results.push({ toolCallId: call.id, name: call.name, content: repairInstruction(v.issues), isError: true });
          }
        } else if (!toolset.byName.has(call.name) || !toolset.investigation.some((t) => t.name === call.name)) {
          results.push({ toolCallId: call.id, name: call.name, content: `Unknown or unavailable tool "${call.name}". Only the listed read-only tools can be used.`, isError: true });
        } else if (toolCalls >= limits.maxToolCalls || contextChars > MAX_CONTEXT_CHARS) {
          results.push({ toolCallId: call.id, name: call.name, content: 'Tool budget exhausted for this run. Call finish_investigation now.', isError: true });
          finished = true;
        } else {
          toolCalls += 1;
          runnable.push(call);
        }
      }

      const executed = await Promise.all(
        runnable.map(async (call) => {
          const tool = toolset.byName.get(call.name);
          usedCategories.add(tool.category);
          await tracker.start(tool.category === 'github' ? 'explore_codebase' : 'investigate_jira');
          const r = await executeTool(tool, call.arguments, ctx);
          trace.push(r.trace);
          await tracker.event(r.summary || `${call.name} completed`, r.isError ? 'warn' : 'info');
          return { call, r };
        })
      );
      for (const { call, r } of executed) {
        if (r.fatal) throw r.cause instanceof IntegrationError ? r.cause : new AgentError('TOOL_FATAL', r.content);
        contextChars += r.content.length;
        results.push({ toolCallId: call.id, name: call.name, content: r.content, isError: r.isError });
      }
      // Preserve the original call order for providers that care.
      const order = new Map(turn.toolCalls.map((c, i) => [c.id, i]));
      results.sort((a, b) => order.get(a.toolCallId) - order.get(b.toolCallId));
      messages.push({ role: 'tool', results });

      if (finalPlan) {
        await enterSynthesis();
        break;
      }
      if (finished) {
        await enterSynthesis();
        messages.push({ role: 'user', content: SYNTHESIS_INSTRUCTION });
      }
      continue;
    }

    // ---- Phase 2: synthesis -----------------------------------------------
    const submit = turn.toolCalls.find((c) => c.name === SUBMIT);
    const results = turn.toolCalls
      .filter((c) => c !== submit)
      .map((c) => ({ toolCallId: c.id, name: c.name, content: `Only ${SUBMIT} is available now.`, isError: true }));

    if (!submit) {
      repairs += 1;
      if (repairs > limits.maxPlanRepairs) throw new AgentError('AGENT_NO_PLAN', 'The AI model did not submit a development plan after repeated requests.', { retryable: true });
      if (results.length) messages.push({ role: 'tool', results });
      messages.push({ role: 'user', content: turn.stopReason === 'max_tokens' ? TRUNCATED_INSTRUCTION : SYNTHESIS_INSTRUCTION });
      await tracker.event('Model did not submit the plan; asking again.', 'warn');
      continue;
    }

    const v = validatePlan(submit.arguments);
    if (v.success && turn.stopReason !== 'max_tokens') {
      finalPlan = v.data;
      break;
    }
    repairs += 1;
    if (repairs > limits.maxPlanRepairs) {
      throw new AgentError(
        'AGENT_INVALID_OUTPUT',
        `The AI model returned an invalid plan ${repairs} times. Last issues: ${(v.issues || []).slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ') || 'output truncated'}`,
        { retryable: true }
      );
    }
    const fix = turn.stopReason === 'max_tokens' ? TRUNCATED_INSTRUCTION : repairInstruction(v.issues);
    results.push({ toolCallId: submit.id, name: SUBMIT, content: fix, isError: true });
    messages.push({ role: 'tool', results });
    await tracker.event(`Plan failed validation (${turn.stopReason === 'max_tokens' ? 'truncated' : `${v.issues.length} issue(s)`}); requesting a corrected version.`, 'warn');
  }

  await tracker.complete('draft_plan');
  await tracker.start('validate_plan');
  const { plan, notes } = verifyPlanEvidence(finalPlan, { observed, siteUrl: jira.siteUrl, github, ticket });
  await tracker.complete('validate_plan', notes.length ? `${notes.length} grounding adjustment(s) applied` : 'All references verified');

  return {
    plan,
    ticket,
    comments,
    contextHash,
    usage,
    trace,
    verificationNotes: notes,
    investigationSummary,
    stats: { iterations, toolCalls, repairs, durationMs: Date.now() - startedAt, filesRead: observed.filePaths.size, issuesSeen: observed.issueKeys.size },
  };
}

module.exports = { runPlanningAgent, AgentError };
