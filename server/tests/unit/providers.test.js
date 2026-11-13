const { AnthropicProvider } = require('../../src/modules/ai/providers/anthropic');
const { OpenAIProvider } = require('../../src/modules/ai/providers/openai');
const { GeminiProvider, sanitizeSchema } = require('../../src/modules/ai/providers/gemini');
const { classifyProviderError } = require('../../src/modules/ai/providers/base');
const { estimateCost } = require('../../src/modules/ai/pricing');

const tools = [{ name: 'get_ticket_details', description: 'd', parameters: { type: 'object', properties: { issueKey: { type: 'string' } }, required: ['issueKey'], additionalProperties: false } }];

describe('Anthropic adapter', () => {
  function fake(response) {
    const sent = [];
    return {
      sent,
      client: {
        messages: { stream: (params) => (sent.push(params), { finalMessage: async () => (typeof response === 'function' ? response(params) : response) }) },
        models: { list: async function* () { yield { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', deprecated_at: null }; } },
      },
    };
  }

  it('converts tool calls/results and normalises usage', async () => {
    const f = fake({
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Looking' }, { type: 'tool_use', id: 't1', name: 'get_ticket_details', input: { issueKey: 'A-1' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    });
    const p = new AnthropicProvider({ client: f.client });
    const turn = await p.executeAgentTurn({ model: 'claude-opus-5-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools, toolChoice: 'auto', maxOutputTokens: 100 });
    expect(turn.toolCalls).toEqual([{ id: 't1', name: 'get_ticket_details', arguments: { issueKey: 'A-1' } }]);
    expect(turn.stopReason).toBe('tool_use');
    expect(turn.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 });
    expect(f.sent[0].tools[0]).toMatchObject({ name: 'get_ticket_details', input_schema: tools[0].parameters });

    // Second turn replays raw content (incl. thinking block) and merges tool results into one user message.
    await p.executeAgentTurn({
      model: 'claude-opus-5-5',
      system: 'sys',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: turn.text, toolCalls: turn.toolCalls, raw: turn.raw },
        { role: 'tool', results: [{ toolCallId: 't1', name: 'get_ticket_details', content: 'data', isError: false }] },
        { role: 'user', content: 'continue' },
      ],
      tools,
      toolChoice: 'auto',
      maxOutputTokens: 100,
    });
    const msgs = f.sent[1].messages;
    expect(msgs[1].content[0]).toMatchObject({ type: 'thinking', signature: 'sig' });
    expect(msgs).toHaveLength(3);
    expect(msgs[2].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'data', is_error: false }, { type: 'text', text: 'continue' }]);
  });

  it('never forces tool_choice on models that reject it; forces it elsewhere', async () => {
    const f = fake({ content: [], stop_reason: 'end_turn', usage: {} });
    const p = new AnthropicProvider({ client: f.client });
    await p.executeAgentTurn({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools, toolChoice: { name: 'get_ticket_details' }, maxOutputTokens: 10 });
    expect(f.sent[0].tool_choice).toEqual({ type: 'auto' });
    await p.executeAgentTurn({ model: 'claude-haiku-4-5', system: 's', messages: [{ role: 'user', content: 'x' }], tools, toolChoice: { name: 'get_ticket_details' }, maxOutputTokens: 10 });
    expect(f.sent[1].tool_choice).toEqual({ type: 'tool', name: 'get_ticket_details' });
    expect(f.sent[1].output_config).toBeUndefined();
  });

  it('maps refusals', async () => {
    const p = new AnthropicProvider({ client: fake({ content: [], stop_reason: 'refusal', usage: {} }).client });
    const t = await p.executeAgentTurn({ model: 'claude-opus-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 10 });
    expect(t.stopReason).toBe('refusal');
  });

  it('lists models for validation', async () => {
    const p = new AnthropicProvider({ client: fake({}).client });
    await expect(p.validateConnection()).resolves.toEqual({ ok: true, models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }] });
  });
});

describe('OpenAI adapter (Responses API)', () => {
  it('parses function calls and chains previous_response_id', async () => {
    const sent = [];
    const client = {
      responses: {
        create: async (params) => {
          sent.push(params);
          return {
            id: `resp_${sent.length}`,
            status: 'completed',
            output: [{ type: 'function_call', call_id: 'c1', name: 'get_ticket_details', arguments: '{"issueKey":"A-1"}' }],
            usage: { input_tokens: 20, output_tokens: 7 },
          };
        },
      },
    };
    const p = new OpenAIProvider({ client });
    const t1 = await p.executeAgentTurn({ model: 'gpt-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools, toolChoice: 'auto', maxOutputTokens: 100 });
    expect(t1.toolCalls).toEqual([{ id: 'c1', name: 'get_ticket_details', arguments: { issueKey: 'A-1' } }]);
    expect(t1.usage).toMatchObject({ inputTokens: 20, outputTokens: 7 });
    expect(sent[0]).toMatchObject({ instructions: 'sys', tool_choice: 'auto' });
    expect(sent[0].tools[0]).toMatchObject({ type: 'function', name: 'get_ticket_details' });

    await p.executeAgentTurn({
      model: 'gpt-5',
      system: 'sys',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: t1.toolCalls, raw: t1.raw },
        { role: 'tool', results: [{ toolCallId: 'c1', name: 'get_ticket_details', content: 'data' }] },
      ],
      tools,
      toolChoice: { name: 'get_ticket_details' },
      maxOutputTokens: 100,
    });
    expect(sent[1].previous_response_id).toBe('resp_1');
    expect(sent[1].input).toEqual([{ type: 'function_call_output', call_id: 'c1', output: 'data' }]);
    expect(sent[1].tool_choice).toEqual({ type: 'function', name: 'get_ticket_details' });
  });

  it('reports truncation as max_tokens', async () => {
    const client = { responses: { create: async () => ({ id: 'r', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: {} }) } };
    const t = await new OpenAIProvider({ client }).executeAgentTurn({ model: 'gpt-5', system: 's', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 5 });
    expect(t.stopReason).toBe('max_tokens');
  });
});

describe('Gemini adapter', () => {
  it('sends function declarations, parses calls and preserves thought signatures', async () => {
    const sent = [];
    const client = {
      models: {
        generateContent: async (params) => {
          sent.push(params);
          return {
            candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'get_ticket_details', args: { issueKey: 'A-1' } }, thoughtSignature: 'sig' }] } }],
            usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 6 },
          };
        },
      },
    };
    const p = new GeminiProvider({ client });
    const t = await p.executeAgentTurn({ model: 'gemini-2.5-pro', system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools, toolChoice: { name: 'get_ticket_details' }, maxOutputTokens: 100 });
    expect(t.toolCalls[0]).toMatchObject({ name: 'get_ticket_details', arguments: { issueKey: 'A-1' } });
    expect(t.usage).toMatchObject({ inputTokens: 30, outputTokens: 10 });
    const decl = sent[0].config.tools[0].functionDeclarations[0];
    expect(decl.parametersJsonSchema.additionalProperties).toBeUndefined();
    expect(sent[0].config.toolConfig.functionCallingConfig).toEqual({ mode: 'ANY', allowedFunctionNames: ['get_ticket_details'] });

    await p.executeAgentTurn({
      model: 'gemini-2.5-pro',
      system: 'sys',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: t.toolCalls, raw: t.raw },
        { role: 'tool', results: [{ toolCallId: t.toolCalls[0].id, name: 'get_ticket_details', content: 'data' }] },
        { role: 'user', content: 'next' },
      ],
      tools,
      maxOutputTokens: 10,
    });
    const contents = sent[1].contents;
    expect(contents[1].parts[0].thoughtSignature).toBe('sig');
    expect(contents).toHaveLength(3); // tool response + follow-up text merged into one user turn
    expect(contents[2].parts[0].functionResponse).toMatchObject({ name: 'get_ticket_details', response: { output: 'data' } });
  });

  it('retries a forced tool call in AUTO mode when Gemini rejects it as an invalid argument', async () => {
    const modes = [];
    const client = {
      models: {
        generateContent: async (params) => {
          const mode = params.config.toolConfig.functionCallingConfig.mode;
          modes.push(mode);
          if (mode === 'ANY') {
            throw Object.assign(new Error(JSON.stringify({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } })), { status: 400 });
          }
          return {
            candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'get_ticket_details', args: { issueKey: 'A-1' } } }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          };
        },
      },
    };
    const t = await new GeminiProvider({ client }).executeAgentTurn({
      model: 'gemini-3.5-flash-lite',
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      tools,
      toolChoice: { name: 'get_ticket_details' },
      maxOutputTokens: 100,
    });
    expect(modes).toEqual(['ANY', 'AUTO']);
    expect(t.toolCalls[0].name).toBe('get_ticket_details');
  });

  it('does not retry invalid-argument errors that occur in AUTO mode', async () => {
    let calls = 0;
    const client = {
      models: {
        generateContent: async () => {
          calls += 1;
          throw Object.assign(new Error(JSON.stringify({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } })), { status: 400 });
        },
      },
    };
    await expect(
      new GeminiProvider({ client }).executeAgentTurn({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], tools, toolChoice: 'auto', maxOutputTokens: 10 })
    ).rejects.toMatchObject({ code: 'AI_BAD_REQUEST' });
    expect(calls).toBe(1);
  });

  it('sanitises unsupported schema keywords', () => {
    expect(sanitizeSchema({ $schema: 'x', type: 'object', additionalProperties: false, properties: { a: { type: 'string', default: 'x' } } })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    });
  });
});

describe('provider error classification', () => {
  it.each([
    [{ status: 401, message: 'invalid x-api-key' }, 'AI_AUTH_FAILED', false],
    [{ status: 429, message: 'rate limited' }, 'AI_RATE_LIMITED', true],
    [{ status: 429, message: 'You exceeded your current quota', code: 'insufficient_quota' }, 'AI_QUOTA_EXCEEDED', false],
    [{ status: 404, message: 'model: foo not found' }, 'AI_MODEL_NOT_FOUND', false],
    [{ status: 529, message: 'Overloaded' }, 'AI_OVERLOADED', true],
    [{ status: 500, message: 'boom' }, 'AI_UNAVAILABLE', true],
    [{ status: 400, message: 'API key not valid. Please pass a valid API key.' }, 'AI_AUTH_FAILED', false],
  ])('%o → %s', (err, code, retryable) => {
    const mapped = classifyProviderError('openai', Object.assign(new Error(err.message), err));
    expect(mapped.code).toBe(code);
    expect(Boolean(mapped.retryable)).toBe(retryable);
  });

  // Shape produced by @google/genai: ApiError.message is the JSON-serialised error body.
  const geminiError = (status, message, statusText) =>
    Object.assign(new Error(JSON.stringify({ error: { code: status, message, status: statusText } })), { name: 'ApiError', status });

  it("includes the provider's own explanation for unavailable models", () => {
    const mapped = classifyProviderError(
      'gemini',
      geminiError(404, 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use a newer model.', 'NOT_FOUND')
    );
    expect(mapped.code).toBe('AI_MODEL_NOT_FOUND');
    expect(mapped.message).toContain('no longer available to new users');
    expect(mapped.message).not.toContain('{"error"');
  });

  it('does not misclassify quota errors that mention a model as model-not-found', () => {
    const mapped = classifyProviderError(
      'gemini',
      geminiError(429, 'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-x. Model not found in free tier.', 'RESOURCE_EXHAUSTED')
    );
    expect(mapped.code).toBe('AI_QUOTA_EXCEEDED');
    expect(mapped.message).toContain('limit: 0');
  });

  it('never echoes API keys in messages', () => {
    const mapped = classifyProviderError('openai', Object.assign(new Error('bad request for key sk-proj-ABCDEFGHIJKLMNOPQRSTUV'), { status: 400 }));
    expect(mapped.message).not.toContain('ABCDEFGHIJKLMNOPQRSTUV');
  });
});

describe('cost estimation', () => {
  it('estimates known models and returns null for unknown ones', () => {
    expect(estimateCost('anthropic', 'claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24);
    expect(estimateCost('anthropic', 'claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.4);
    expect(estimateCost('openai', 'some-future-model', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
  it('applies tiered pricing', () => {
    expect(estimateCost('gemini', 'gemini-2.5-pro', { inputTokens: 300_000, outputTokens: 0 })).toBeCloseTo(0.75);
  });
});
