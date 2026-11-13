'use strict';

const OpenAI = require('openai').default;
const { classifyProviderError, emptyUsage, safeJsonParse } = require('./base');

const PROVIDER = 'openai';

// Chat-capable model families exposed in the model picker.
const CHAT_MODEL_RE = /^(gpt-|o\d|chatgpt-)/;
const EXCLUDE_RE = /(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct|codex-mini|-\d{4}-\d{2}-\d{2}$)/;

const SUGGESTED_MODELS = [
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
];

/**
 * OpenAI adapter using the Responses API with function tools. Conversation
 * state is chained server-side via previous_response_id, which keeps reasoning
 * items intact across tool-calling turns without resending them.
 */
class OpenAIProvider {
  constructor({ apiKey, client }) {
    this.provider = PROVIDER;
    this.client = client || new OpenAI({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }

  static suggestedModels() {
    return SUGGESTED_MODELS;
  }

  normalizeUsage(u) {
    if (!u) return emptyUsage();
    return {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: 0, // cached tokens are included in input_tokens for OpenAI
      cacheWriteTokens: 0,
    };
  }

  async getAvailableModels() {
    try {
      const models = [];
      for await (const m of this.client.models.list()) {
        if (CHAT_MODEL_RE.test(m.id) && !EXCLUDE_RE.test(m.id)) models.push({ id: m.id, name: m.id });
      }
      return models.sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyProviderError(PROVIDER, err);
    }
  }

  async validateConnection() {
    return { ok: true, models: await this.getAvailableModels() };
  }

  /** Converts messages after the last assistant turn (or all, for the first turn) into Responses input items. */
  toInput(messages) {
    let start = 0;
    let previousResponseId = null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant' && messages[i].raw?.responseId) {
        previousResponseId = messages[i].raw.responseId;
        start = i + 1;
        break;
      }
    }
    const input = [];
    for (const m of messages.slice(start)) {
      if (m.role === 'user') input.push({ role: 'user', content: m.content });
      else if (m.role === 'tool') {
        m.results.forEach((r) => input.push({ type: 'function_call_output', call_id: r.toolCallId, output: r.content }));
      } else if (m.role === 'assistant') {
        // Assistant turns without a response id (not produced by this adapter) are replayed as text.
        if (m.content) input.push({ role: 'assistant', content: m.content });
      }
    }
    return { input, previousResponseId };
  }

  async executeAgentTurn({ model, system, messages, tools, toolChoice, maxOutputTokens, signal }) {
    const { input, previousResponseId } = this.toInput(messages);
    const params = {
      model,
      instructions: system,
      input,
      max_output_tokens: maxOutputTokens,
      store: true,
    };
    if (previousResponseId) params.previous_response_id = previousResponseId;
    if (tools?.length) {
      params.tools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
      if (toolChoice === 'none') params.tool_choice = 'none';
      else if (toolChoice?.name) params.tool_choice = { type: 'function', name: toolChoice.name };
      else params.tool_choice = 'auto';
    }
    let response;
    try {
      response = await this.client.responses.create(params, { signal });
    } catch (err) {
      throw classifyProviderError(PROVIDER, err);
    }
    const output = response.output || [];
    const toolCalls = output
      .filter((o) => o.type === 'function_call')
      .map((o) => ({ id: o.call_id, name: o.name, arguments: safeJsonParse(o.arguments) }));
    const text = (
      response.output_text ??
      output
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content || [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text)
        .join('\n')
    ).trim();
    const refused = output.some((o) => o.type === 'message' && (o.content || []).some((c) => c.type === 'refusal'));
    let stopReason = toolCalls.length ? 'tool_use' : 'end_turn';
    if (response.status === 'incomplete') stopReason = response.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : 'other';
    if (refused) stopReason = 'refusal';
    return { text, toolCalls, stopReason, usage: this.normalizeUsage(response.usage), raw: { responseId: response.id } };
  }

  async generateResponse({ model, system, prompt, maxOutputTokens = 1024, signal }) {
    const res = await this.executeAgentTurn({ model, system, messages: [{ role: 'user', content: prompt }], maxOutputTokens, signal });
    return { text: res.text, usage: res.usage, stopReason: res.stopReason };
  }
}

module.exports = { OpenAIProvider };
