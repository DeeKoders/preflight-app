'use strict';

const { AnthropicProvider } = require('./anthropic');
const { OpenAIProvider } = require('./openai');
const { GeminiProvider } = require('./gemini');

const REGISTRY = {
  anthropic: { label: 'Anthropic Claude', Adapter: AnthropicProvider, keyUrl: 'https://console.anthropic.com/settings/keys', keyPrefix: 'sk-ant-' },
  openai: { label: 'OpenAI', Adapter: OpenAIProvider, keyUrl: 'https://platform.openai.com/api-keys', keyPrefix: 'sk-' },
  gemini: { label: 'Google Gemini', Adapter: GeminiProvider, keyUrl: 'https://aistudio.google.com/app/apikey', keyPrefix: 'AIza' },
};

// Swappable for tests (inject fake SDK clients).
let factory = (provider, apiKey) => {
  const entry = REGISTRY[provider];
  if (!entry) throw new Error(`Unsupported AI provider: ${provider}`);
  return new entry.Adapter({ apiKey });
};

const createProvider = (provider, apiKey) => factory(provider, apiKey);
const setProviderFactory = (fn) => {
  factory = fn;
};

function describeProviders() {
  return Object.entries(REGISTRY).map(([id, e]) => ({
    id,
    label: e.label,
    keyUrl: e.keyUrl,
    keyPrefix: e.keyPrefix,
    suggestedModels: e.Adapter.suggestedModels(),
  }));
}

module.exports = { createProvider, setProviderFactory, describeProviders, PROVIDER_IDS: Object.keys(REGISTRY) };
