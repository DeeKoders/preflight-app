'use strict';

const { z } = require('zod');
const { toToolSchema, planSchema } = require('../planSchema');
const { wrapUntrusted } = require('../untrusted');
const { jiraTools } = require('./jiraTools');
const { githubTools } = require('./githubTools');

const finishInvestigationTool = {
  name: 'finish_investigation',
  category: 'control',
  description: 'Signal that investigation is complete. Provide a short summary of findings and what remains unknown. Call this once, when you are ready to write the plan.',
  input: z.object({
    summary: z.string().trim().min(1).max(4000),
    unknowns: z.array(z.string().trim().max(500)).max(30).default([]),
  }),
};

const submitPlanTool = {
  name: 'submit_development_plan',
  category: 'control',
  description: 'Submit the final, complete, structured development plan. Must follow the schema exactly.',
  input: planSchema,
};

const toDefinition = (tool) => ({ name: tool.name, description: tool.description, parameters: toToolSchema(tool.input) });

/**
 * Builds the read-only tool set for a run. GitHub tools are only registered
 * when the user has connected GitHub AND selected a repository for this run.
 */
function buildToolset({ githubAvailable }) {
  const investigation = [...jiraTools, ...(githubAvailable ? githubTools : [])];
  const byName = new Map([...investigation, finishInvestigationTool, submitPlanTool].map((t) => [t.name, t]));
  return {
    investigation,
    byName,
    investigationDefinitions: [...investigation, finishInvestigationTool].map(toDefinition),
    submitDefinitions: [toDefinition(submitPlanTool)],
  };
}

const describeArgs = (args) => {
  const s = JSON.stringify(args || {});
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
};

/** Validates arguments and runs an investigation tool. Never throws: failures become error results. */
async function executeTool(tool, rawArgs, ctx) {
  const started = Date.now();
  const parsed = tool.input.safeParse(rawArgs || {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return { isError: true, content: `Invalid arguments for ${tool.name}: ${message}`, trace: { tool: tool.name, args: describeArgs(rawArgs), ok: false, error: 'invalid_arguments', durationMs: 0 } };
  }
  try {
    const result = await tool.run(parsed.data, ctx);
    const wrapped = wrapUntrusted(result.source, result.data);
    return {
      isError: false,
      content: wrapped.text,
      summary: result.summary,
      trace: { tool: tool.name, args: describeArgs(parsed.data), ok: true, summary: result.summary, truncated: wrapped.truncated, durationMs: Date.now() - started },
    };
  } catch (err) {
    const message = (err && err.message) || 'Tool failed';
    return {
      isError: true,
      content: `${tool.name} failed: ${message}`,
      summary: `${tool.name} failed: ${message}`,
      trace: { tool: tool.name, args: describeArgs(parsed.data), ok: false, error: err.code || 'tool_error', message, durationMs: Date.now() - started },
      fatal: err.code === 'JIRA_AUTH_FAILED' || err.code === 'GITHUB_AUTH_FAILED',
      cause: err,
    };
  }
}

module.exports = { buildToolset, executeTool, finishInvestigationTool, submitPlanTool };
