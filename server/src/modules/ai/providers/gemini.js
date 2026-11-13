'use strict';

const { GoogleGenAI, FunctionCallingConfigMode } = require('@google/genai');
const { classifyProviderError, emptyUsage } = require('./base');

const PROVIDER = 'gemini';

// Current stable models (Nov 2026). gemini-2.5-flash / -pro are restricted to
// pre-existing users, so new keys get a 404 for them. "Load models" shows the live list.
const SUGGESTED_MODELS = [
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
];

/** Gemini function declarations accept a JSON Schema subset; drop keywords it rejects. */
function sanitizeSchema(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['$schema', 'additionalProperties', '$id', 'default'].includes(k)) continue;
    out[k] = sanitizeSchema(v);
  }
  return out;
}

class GeminiProvider {
  constructor({ apiKey, client }) {
    this.provider = PROVIDER;
    this.client = client || new GoogleGenAI({ apiKey });
  }

  static suggestedModels() {
    return SUGGESTED_MODELS;
  }

  normalizeUsage(u) {
    if (!u) return emptyUsage();
    return {
      inputTokens: Math.max(0, (u.promptTokenCount || 0) - (u.cachedContentTokenCount || 0)),
      // Thinking tokens are billed as output tokens.
      outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
      cacheReadTokens: u.cachedContentTokenCount || 0,
      cacheWriteTokens: 0,
    };
  }

  async getAvailableModels() {
    try {
      const pager = await this.client.models.list({ config: { pageSize: 100 } });
      const models = [];
      for await (const m of pager) {
        const actions = m.supportedActions || [];
        const id = String(m.name || '').replace(/^models\//, '');
        if (!actions.includes('generateContent') || !/^gemini-/.test(id) || /(embedding|tts|image|live|audio)/.test(id)) continue;
        models.push({ id, name: m.displayName || id });
      }
      return models;
    } catch (err) {
      throw classifyProviderError(PROVIDER, err);
    }
  }

  async validateConnection() {
    return { ok: true, models: await this.getAvailableModels() };
  }

  toContents(messages) {
    const contents = [];
    const pushUser = (parts) => {
      const last = contents[contents.length - 1];
      if (last && last.role === 'user') last.parts.push(...parts);
      else contents.push({ role: 'user', parts });
    };
    for (const m of messages) {
      if (m.role === 'user') pushUser([{ text: m.content }]);
      else if (m.role === 'assistant') {
        // Replay the model's original content so thought signatures are preserved.
        const content = m.raw?.content || {
          role: 'model',
          parts: [
            ...(m.content ? [{ text: m.content }] : []),
            ...(m.toolCalls || []).map((c) => ({ functionCall: { id: c.id, name: c.name, args: c.arguments } })),
          ],
        };
        contents.push(content);
      } else if (m.role === 'tool') {
        pushUser(
          m.results.map((r) => ({
            functionResponse: { id: r.toolCallId, name: r.name, response: r.isError ? { error: r.content } : { output: r.content } },
          }))
        );
      }
    }
    return contents;
  }

  async executeAgentTurn({ model, system, messages, tools, toolChoice, maxOutputTokens, signal }) {
    const config = { systemInstruction: system, maxOutputTokens, abortSignal: signal };
    if (tools?.length) {
      config.tools = [
        { functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: sanitizeSchema(t.parameters) })) },
      ];
      const mode =
        toolChoice === 'none' ? FunctionCallingConfigMode.NONE : toolChoice?.name ? FunctionCallingConfigMode.ANY : FunctionCallingConfigMode.AUTO;
      config.toolConfig = { functionCallingConfig: { mode, ...(toolChoice?.name ? { allowedFunctionNames: [toolChoice.name] } : {}) } };
    }
    const contents = this.toContents(messages);
    let response;
    try {
      response = await this.client.models.generateContent({ model, contents, config });
    } catch (err) {
      // Forcing a call (mode ANY) enables constrained decoding, which Gemini rejects with a bare
      // INVALID_ARGUMENT when a schema exceeds its (undocumented) complexity budget — e.g. the plan
      // schema. Retry the same turn once in AUTO mode; the orchestrator re-prompts if no call is made.
      const forced = config.toolConfig?.functionCallingConfig?.mode === FunctionCallingConfigMode.ANY;
      if (forced && err?.status === 400 && /INVALID_ARGUMENT|invalid argument/i.test(String(err.message))) {
        try {
          response = await this.client.models.generateContent({
            model,
            contents,
            config: { ...config, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } },
          });
        } catch (err2) {
          throw classifyProviderError(PROVIDER, err2);
        }
      } else {
        throw classifyProviderError(PROVIDER, err);
      }
    }
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({ id: p.functionCall.id || `call_${Date.now()}_${i}`, name: p.functionCall.name, arguments: p.functionCall.args || {} }));
    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('\n')
      .trim();
    const finish = candidate?.finishReason;
    let stopReason = toolCalls.length ? 'tool_use' : 'end_turn';
    if (finish === 'MAX_TOKENS') stopReason = 'max_tokens';
    else if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(finish) || response.promptFeedback?.blockReason) stopReason = 'refusal';
    // Keep ids aligned between our toolCalls and the replayed content.
    const content = candidate?.content
      ? {
          ...candidate.content,
          role: 'model',
          parts: parts.map((p) => {
            if (!p.functionCall) return p;
            const call = toolCalls.find((c) => c.name === p.functionCall.name && (!p.functionCall.id || c.id === p.functionCall.id));
            return { ...p, functionCall: { ...p.functionCall, id: call?.id } };
          }),
        }
      : { role: 'model', parts: [{ text: text || '' }] };
    return { text, toolCalls, stopReason, usage: this.normalizeUsage(response.usageMetadata), raw: { content } };
  }

  async generateResponse({ model, system, prompt, maxOutputTokens = 1024, signal }) {
    const res = await this.executeAgentTurn({ model, system, messages: [{ role: 'user', content: prompt }], maxOutputTokens, signal });
    return { text: res.text, usage: res.usage, stopReason: res.stopReason };
  }
}

module.exports = { GeminiProvider, sanitizeSchema };
