'use strict';

const { IntegrationError } = require('../../../lib/errors');

/**
 * Common AI provider contract. Every adapter implements:
 *
 *   validateConnection()                       -> { ok: true, models: [...] }
 *   getAvailableModels()                       -> [{ id, name }]
 *   generateResponse({ model, system, prompt, maxOutputTokens, signal })
 *                                              -> { text, usage, stopReason }
 *   executeAgentTurn({ model, system, messages, tools, toolChoice, maxOutputTokens, signal })
 *                                              -> { text, toolCalls, stopReason, usage, raw }
 *   normalizeUsage(rawUsage)                   -> { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
 *
 * Provider-neutral conversation format used by the orchestrator:
 *   { role: 'user', content: string }
 *   { role: 'assistant', content: string, toolCalls: [{ id, name, arguments }], raw }
 *   { role: 'tool', results: [{ toolCallId, name, content: string, isError }] }
 *
 * `raw` carries the provider's own representation of the assistant turn so it
 * can be replayed verbatim (thinking blocks, thought signatures, response ids).
 * A run never mixes providers, so raw is only ever read by the adapter that wrote it.
 *
 * toolChoice: 'auto' | 'none' | { name } — adapters that cannot force a tool
 * degrade to 'auto'; the orchestrator re-prompts if the tool is not called.
 *
 * stopReason (normalised): 'tool_use' | 'end_turn' | 'max_tokens' | 'refusal' | 'other'
 */

const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

/**
 * Extracts the human-readable message from an SDK error. Gemini's SDK serialises
 * the whole JSON error body into `message`; Anthropic/OpenAI prefix it with the
 * status code. Falls back to the raw text.
 */
function providerMessage(raw) {
  const start = raw.indexOf('{');
  if (start !== -1) {
    try {
      const body = JSON.parse(raw.slice(start));
      const msg = body?.error?.message || body?.message;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    } catch {
      /* not JSON — use raw text */
    }
  }
  return raw.trim();
}

/** Maps SDK errors (all three SDKs expose a numeric `status`) to IntegrationErrors. */
function classifyProviderError(provider, err) {
  if (err instanceof IntegrationError) return err;
  if (err?.name === 'AbortError' || err?.constructor?.name === 'APIUserAbortError') {
    return new IntegrationError({ service: provider, code: 'AI_ABORTED', message: 'The AI request was cancelled because the job timed out.', status: 504 });
  }
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status) || undefined;
  const raw = String(err?.message || '');
  const code = err?.code || err?.error?.code || err?.error?.error?.type || '';
  const label = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini' }[provider] || provider;
  const detail = providerMessage(raw)
    .replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1…')
    .replace(/AIza[0-9A-Za-z_-]+/g, 'AIza…')
    .slice(0, 300);

  if (status === 401 || (status === 400 && /api[_ ]?key.*(invalid|not valid)/i.test(raw)) || (status === 403 && provider === 'gemini' && /api key/i.test(raw))) {
    return new IntegrationError({ service: provider, code: 'AI_AUTH_FAILED', message: `${label} rejected the API key. Check that it is valid and active.`, status: 401 });
  }
  if (status === 403) {
    return new IntegrationError({ service: provider, code: 'AI_FORBIDDEN', message: `${label} denied access: ${detail}`, status: 403 });
  }
  // Only 404s (or 400s that say so) mean the model is unavailable — never 429 quota errors that mention a model.
  if (status === 404 || (status === 400 && /model.*(not found|does not exist)|not_found_error/i.test(raw))) {
    return new IntegrationError({
      service: provider,
      code: 'AI_MODEL_NOT_FOUND',
      message: `The selected ${label} model is not available for this API key. Choose a different model.${detail ? ` ${label} said: ${detail}` : ''}`,
      status: 400,
    });
  }
  if (status === 429 && /insufficient_quota|quota|billing|credit balance/i.test(`${raw} ${code}`)) {
    return new IntegrationError({
      service: provider,
      code: 'AI_QUOTA_EXCEEDED',
      message: `${label} reports the account is out of quota or credits for this model. Check your plan or billing settings.${detail ? ` ${label} said: ${detail}` : ''}`,
      status: 402,
    });
  }
  if (status === 429) {
    const retryAfter = Number(err?.headers?.get?.('retry-after') ?? err?.headers?.['retry-after']);
    return new IntegrationError({
      service: provider,
      code: 'AI_RATE_LIMITED',
      message: `${label} rate limit reached. The job will retry automatically with backoff.`,
      status: 429,
      retryable: true,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 30_000,
    });
  }
  if (status === 400 && /context|too long|too many tokens|maximum.*tokens/i.test(raw)) {
    return new IntegrationError({ service: provider, code: 'AI_CONTEXT_TOO_LARGE', message: `The request exceeded the ${label} model's context window.`, status: 400 });
  }
  if (status === 400 || status === 422) {
    return new IntegrationError({ service: provider, code: 'AI_BAD_REQUEST', message: `${label} rejected the request: ${detail}`, status: 400 });
  }
  if (status === 529 || status === 503 || /overloaded/i.test(raw)) {
    return new IntegrationError({ service: provider, code: 'AI_OVERLOADED', message: `${label} is temporarily overloaded. The job will retry.`, status: 503, retryable: true });
  }
  if (status && status >= 500) {
    return new IntegrationError({ service: provider, code: 'AI_UNAVAILABLE', message: `${label} returned a server error (HTTP ${status}).`, status: 502, retryable: true });
  }
  if (/timeout|timed out/i.test(raw)) {
    return new IntegrationError({ service: provider, code: 'AI_TIMEOUT', message: `${label} did not respond in time.`, status: 504, retryable: true });
  }
  return new IntegrationError({ service: provider, code: 'AI_NETWORK_ERROR', message: `Could not reach ${label}: ${detail || 'network error'}`, status: 502, retryable: true });
}

function safeJsonParse(text) {
  if (text && typeof text === 'object') return text;
  try {
    return JSON.parse(text || '{}');
  } catch {
    return { __invalid_json__: String(text).slice(0, 2000) };
  }
}

module.exports = { classifyProviderError, emptyUsage, safeJsonParse };
