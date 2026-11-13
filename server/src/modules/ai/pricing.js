'use strict';

/**
 * Per-million-token list prices (USD) used to ESTIMATE cost. Only models with
 * documented prices are listed; anything else returns null (shown as "not
 * available") — costs are never guessed. Override or extend at runtime with
 * the PRICING_OVERRIDES_JSON env var, e.g.
 *   {"openai:gpt-5.2":{"input":1.5,"output":12}}
 *
 * Anthropic prices: Claude API first-party rates (Oct 2026).
 * OpenAI / Gemini prices: published list prices for long-standing model IDs;
 * verify against the provider's pricing page for your account.
 */
const BASE = {
  // Anthropic
  'anthropic:claude-fable-5-1': { input: 10, output: 50 },
  'anthropic:claude-fable-5': { input: 10, output: 50 },
  'anthropic:claude-opus-5-5': { input: 4, output: 20 },
  'anthropic:claude-opus-5': { input: 5, output: 25 },
  'anthropic:claude-opus-4-8': { input: 5, output: 25 },
  'anthropic:claude-opus-4-7': { input: 5, output: 25 },
  'anthropic:claude-opus-4-6': { input: 5, output: 25 },
  'anthropic:claude-sonnet-5-5': { input: 2, output: 10 },
  'anthropic:claude-sonnet-5': { input: 2, output: 10 },
  'anthropic:claude-sonnet-4-6': { input: 3, output: 15 },
  'anthropic:claude-haiku-5-5': { input: 0.1, output: 0.5, tiers: [{ aboveInputTokens: 100_000, input: 0.5, output: 2.5 }] },
  'anthropic:claude-haiku-4-5': { input: 1, output: 5 },
  // OpenAI
  'openai:gpt-5': { input: 1.25, output: 10 },
  'openai:gpt-5-mini': { input: 0.25, output: 2 },
  'openai:gpt-4.1': { input: 2, output: 8 },
  'openai:gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'openai:gpt-4o': { input: 2.5, output: 10 },
  'openai:gpt-4o-mini': { input: 0.15, output: 0.6 },
  // Google Gemini
  'gemini:gemini-2.5-pro': { input: 1.25, output: 10, tiers: [{ aboveInputTokens: 200_000, input: 2.5, output: 15 }] },
  'gemini:gemini-2.5-flash': { input: 0.3, output: 2.5 },
};

function loadOverrides() {
  if (!process.env.PRICING_OVERRIDES_JSON) return {};
  try {
    return JSON.parse(process.env.PRICING_OVERRIDES_JSON);
  } catch {
    return {};
  }
}

const TABLE = { ...BASE, ...loadOverrides() };

function priceFor(provider, model) {
  const id = String(model || '').replace(/^models\//, '');
  return TABLE[`${provider}:${id}`] || null;
}

/**
 * Estimates the USD cost of one request. Returns null when pricing is unknown.
 * Anthropic cache reads/writes are billed at 0.1x / 1.25x the input rate.
 */
function estimateCost(provider, model, usage) {
  const price = priceFor(provider, model);
  if (!price || !usage) return null;
  const promptTokens = (usage.inputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
  const tier = (price.tiers || []).filter((t) => promptTokens > t.aboveInputTokens).pop();
  const rate = tier || price;
  const cost =
    ((usage.inputTokens || 0) * rate.input +
      (usage.cacheReadTokens || 0) * rate.input * 0.1 +
      (usage.cacheWriteTokens || 0) * rate.input * 1.25 +
      (usage.outputTokens || 0) * rate.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

module.exports = { estimateCost, priceFor };
