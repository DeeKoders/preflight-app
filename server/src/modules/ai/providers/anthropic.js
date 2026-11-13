'use strict';

const Anthropic = require('@anthropic-ai/sdk').default;
const { classifyProviderError, emptyUsage } = require('./base');

const PROVIDER = 'anthropic';

// Models that accept output_config.effort (Opus 4.6+, Sonnet 4.6+, Sonnet/Opus/Fable 5.x, Haiku 5.5).
const EFFORT_RE = /^claude-(opus-(4-[6-9]|5)|sonnet-(4-6|5)|fable-5|mythos-5|haiku-5)/;
// Models where forced tool_choice ('any' / 'tool') is rejected with a 400.
const NO_FORCED_TOOL_RE = /^claude-(opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)/;

const SUGGESTED_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
];

class AnthropicProvider {
  constructor({ apiKey, client }) {
    this.provider = PROVIDER;
    this.client = client || new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }

  static suggestedModels() {
    return SUGGESTED_MODELS;
  }

  normalizeUsage(u) {
    if (!u) return emptyUsage();
    return {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheWriteTokens: u.cache_creation_input_tokens || 0,
    };
  }

  async getAvailableModels() {
    try {
      const models = [];
      for await (const m of this.client.models.list({ limit: 100 })) {
        if (m.deprecated_at) continue;
        models.push({ id: m.id, name: m.display_name || m.id });
      }
      return models;
    } catch (err) {
      throw classifyProviderError(PROVIDER, err);
    }
  }

  async validateConnection() {
    const models = await this.getAvailableModels();
    return { ok: true, models };
  }

  toMessages(messages) {
    const out = [];
    const pushUser = (blocks) => {
      const last = out[out.length - 1];
      if (last && last.role === 'user') last.content.push(...blocks);
      else out.push({ role: 'user', content: blocks });
    };
    for (const m of messages) {
      if (m.role === 'user') pushUser([{ type: 'text', text: m.content }]);
      else if (m.role === 'tool') {
        pushUser(
          m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.toolCallId, content: r.content, is_error: Boolean(r.isError) }))
        );
      } else if (m.role === 'assistant') {
        // Replay the original content blocks (incl. thinking blocks) unchanged.
        const content = m.raw?.content || [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...(m.toolCalls || []).map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments })),
        ];
        out.push({ role: 'assistant', content });
      }
    }
    return out;
  }

  buildParams({ model, system, messages, tools, toolChoice, maxOutputTokens }) {
    const params = {
      model,
      max_tokens: maxOutputTokens,
      // Stable system prompt is cached to reduce cost across agent turns.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: this.toMessages(messages),
    };
    if (EFFORT_RE.test(model)) params.output_config = { effort: 'high' };
    if (tools?.length) {
      params.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      if (toolChoice === 'none') params.tool_choice = { type: 'none' };
      else if (toolChoice && toolChoice.name && !NO_FORCED_TOOL_RE.test(model)) params.tool_choice = { type: 'tool', name: toolChoice.name };
      else params.tool_choice = { type: 'auto' };
    }
    return params;
  }

  async send(params, signal) {
    // Streaming avoids HTTP timeouts on long generations; finalMessage() assembles the result.
    const stream = this.client.messages.stream(params, { signal });
    return stream.finalMessage();
  }

  async executeAgentTurn(opts) {
    const params = this.buildParams(opts);
    let response;
    try {
      response = await this.send(params, opts.signal);
    } catch (err) {
      // Some models reject forced tool choice (e.g. with thinking on): degrade to auto once.
      if (err?.status === 400 && params.tool_choice?.type === 'tool' && /tool_choice/i.test(String(err.message))) {
        try {
          response = await this.send({ ...params, tool_choice: { type: 'auto' } }, opts.signal);
        } catch (err2) {
          throw classifyProviderError(PROVIDER, err2);
        }
      } else {
        throw classifyProviderError(PROVIDER, err);
      }
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const toolCalls = response.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input && typeof b.input === 'object' ? b.input : {} }));
    const stopReason =
      { tool_use: 'tool_use', end_turn: 'end_turn', max_tokens: 'max_tokens', refusal: 'refusal', model_context_window_exceeded: 'max_tokens' }[
        response.stop_reason
      ] || 'other';
    return { text, toolCalls, stopReason, usage: this.normalizeUsage(response.usage), raw: { content: response.content } };
  }

  async generateResponse({ model, system, prompt, maxOutputTokens = 1024, signal }) {
    const res = await this.executeAgentTurn({ model, system, messages: [{ role: 'user', content: prompt }], maxOutputTokens, signal });
    return { text: res.text, usage: res.usage, stopReason: res.stopReason };
  }
}

module.exports = { AnthropicProvider };
