'use strict';

const { Op, fn, col } = require('sequelize');
const { sequelize, AIProviderSetting, AIUsageLog, Ticket } = require('../../db');
const { encryptSecret, decryptSecret, maskSecret } = require('../../lib/crypto');
const { badRequest, notFound, preconditionRequired, IntegrationError } = require('../../lib/errors');
const { createProvider, describeProviders } = require('./providers');
const { estimateCost, priceFor } = require('./pricing');

const keyContext = (userId, provider) => `ai-key:${userId}:${provider}`;

function decryptKey(setting) {
  return decryptSecret(setting.encryptedApiKey, keyContext(setting.userId, setting.provider));
}

const listProviders = () =>
  describeProviders().map((p) => ({
    ...p,
    suggestedModels: p.suggestedModels.map((m) => ({ ...m, pricing: priceFor(p.id, m.id) })),
  }));

async function listSettings(userId) {
  const rows = await AIProviderSetting.findAll({ where: { userId }, order: [['isDefault', 'DESC'], ['createdAt', 'ASC']] });
  return rows.map((r) => ({ ...r.toSafeJSON(), pricing: priceFor(r.provider, r.model) }));
}

async function findOwnedSetting(userId, id) {
  const setting = await AIProviderSetting.findOne({ where: { id, userId } });
  if (!setting) throw notFound('AI provider setting');
  return setting;
}

/**
 * Creates or updates the user's configuration for a provider (one per provider).
 * When a new key is supplied it is validated against the provider before it is stored.
 */
async function upsertSetting(userId, { provider, model, apiKey, isDefault }) {
  const existing = await AIProviderSetting.findOne({ where: { userId, provider } });
  if (!existing && !apiKey) throw badRequest('An API key is required to configure a new provider');

  const values = { model };
  if (apiKey) {
    await createProvider(provider, apiKey).validateConnection(); // throws a mapped IntegrationError on failure
    Object.assign(values, {
      encryptedApiKey: encryptSecret(apiKey, keyContext(userId, provider)),
      keyMask: maskSecret(apiKey),
      validationStatus: 'valid',
      lastValidatedAt: new Date(),
      lastError: null,
    });
  }

  return sequelize.transaction(async (transaction) => {
    const count = await AIProviderSetting.count({ where: { userId }, transaction });
    const makeDefault = Boolean(isDefault) || count === 0 || (existing?.isDefault && isDefault !== false);
    if (makeDefault) {
      await AIProviderSetting.update({ isDefault: false }, { where: { userId, isDefault: true }, transaction });
    }
    values.isDefault = makeDefault;
    const setting = existing
      ? await existing.update(values, { transaction })
      : await AIProviderSetting.create({ userId, provider, ...values }, { transaction });
    return setting.toSafeJSON();
  });
}

async function setDefault(userId, id) {
  const setting = await findOwnedSetting(userId, id);
  await sequelize.transaction(async (transaction) => {
    await AIProviderSetting.update({ isDefault: false }, { where: { userId, isDefault: true }, transaction });
    await setting.update({ isDefault: true }, { transaction });
  });
  return setting.toSafeJSON();
}

async function deleteSetting(userId, id) {
  const setting = await findOwnedSetting(userId, id);
  await sequelize.transaction(async (transaction) => {
    await setting.destroy({ transaction });
    if (setting.isDefault) {
      const next = await AIProviderSetting.findOne({ where: { userId }, order: [['createdAt', 'ASC']], transaction });
      if (next) await next.update({ isDefault: true }, { transaction });
    }
  });
}

async function recordUsage({ userId, provider, model, ticketId = null, planningJobId = null, operation, usage }) {
  const cost = estimateCost(provider, model, usage);
  await AIUsageLog.create({
    userId,
    provider,
    model,
    ticketId,
    planningJobId,
    operation,
    inputTokens: (usage?.inputTokens || 0) + (usage?.cacheReadTokens || 0) + (usage?.cacheWriteTokens || 0),
    outputTokens: usage?.outputTokens || 0,
    estimatedCost: cost,
  });
  return cost;
}

/**
 * Tests a key + model with a minimal live generation request. Accepts either a
 * saved setting id or an unsaved { provider, apiKey, model } triple.
 */
async function testConnection(userId, { settingId, provider, apiKey, model }) {
  let setting = null;
  if (settingId) {
    setting = await findOwnedSetting(userId, settingId);
    provider = setting.provider;
    model = model || setting.model;
    apiKey = decryptKey(setting);
  }
  if (!provider || !apiKey || !model) throw badRequest('Provide a saved setting id, or provider, API key and model');
  const adapter = createProvider(provider, apiKey);
  const started = Date.now();
  try {
    const res = await adapter.generateResponse({
      model,
      system: 'You are a connectivity check. Reply with the single word: OK',
      prompt: 'Connectivity check.',
      maxOutputTokens: 256,
    });
    await recordUsage({ userId, provider, model, operation: 'connection_test', usage: res.usage });
    if (setting) await setting.update({ validationStatus: 'valid', lastValidatedAt: new Date(), lastError: null });
    return { ok: true, provider, model, latencyMs: Date.now() - started, usage: res.usage };
  } catch (err) {
    if (setting && err instanceof IntegrationError && ['AI_AUTH_FAILED', 'AI_MODEL_NOT_FOUND', 'AI_FORBIDDEN', 'AI_QUOTA_EXCEEDED'].includes(err.code)) {
      await setting.update({ validationStatus: 'invalid', lastValidatedAt: new Date(), lastError: err.message });
    }
    throw err;
  }
}

async function listModels(userId, { settingId, provider, apiKey }) {
  if (settingId) {
    const setting = await findOwnedSetting(userId, settingId);
    provider = setting.provider;
    apiKey = decryptKey(setting);
  }
  if (!provider || !apiKey) throw badRequest('Provide a saved setting id, or a provider and API key');
  const models = await createProvider(provider, apiKey).getAvailableModels();
  return models.map((m) => ({ ...m, pricing: priceFor(provider, m.id) }));
}

/**
 * Resolves the provider for a planning run. The explicitly chosen setting (or
 * the user's default) is used — there is never an automatic fallback to a
 * different provider.
 */
async function resolveForPlanning(userId, settingId) {
  const setting = settingId
    ? await AIProviderSetting.findOne({ where: { id: settingId, userId } })
    : await AIProviderSetting.findOne({ where: { userId, isDefault: true } });
  if (!setting) {
    throw preconditionRequired('AI_NOT_CONFIGURED', 'Configure an AI provider and API key on the AI Settings page first.');
  }
  return { setting, adapter: createProvider(setting.provider, decryptKey(setting)) };
}

async function getUsage(userId, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const where = { userId, createdAt: { [Op.gte]: since } };
  const [byModel, recent] = await Promise.all([
    AIUsageLog.findAll({
      where,
      attributes: [
        'provider',
        'model',
        [fn('COUNT', col('id')), 'requests'],
        [fn('SUM', col('input_tokens')), 'inputTokens'],
        [fn('SUM', col('output_tokens')), 'outputTokens'],
        [fn('SUM', col('estimated_cost')), 'estimatedCost'],
        [fn('COUNT', col('estimated_cost')), 'pricedRequests'],
      ],
      group: ['provider', 'model'],
      raw: true,
    }),
    AIUsageLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 25,
      include: [{ model: Ticket, as: 'ticket', attributes: ['jiraIssueKey'] }],
    }),
  ]);
  const breakdown = byModel.map((r) => {
    const requests = Number(r.requests);
    const priced = Number(r.pricedRequests);
    return {
      provider: r.provider,
      model: r.model,
      requests,
      inputTokens: Number(r.inputTokens) || 0,
      outputTokens: Number(r.outputTokens) || 0,
      // Cost is only reported when every request for the model could be priced.
      estimatedCost: priced === requests && r.estimatedCost !== null ? Number(r.estimatedCost) : null,
      costAvailable: priced === requests,
    };
  });
  const totals = breakdown.reduce(
    (acc, b) => ({
      requests: acc.requests + b.requests,
      inputTokens: acc.inputTokens + b.inputTokens,
      outputTokens: acc.outputTokens + b.outputTokens,
      estimatedCost: b.estimatedCost === null || acc.estimatedCost === null ? null : acc.estimatedCost + b.estimatedCost,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, estimatedCost: breakdown.length ? 0 : 0 }
  );
  return {
    days,
    totals,
    breakdown,
    recent: recent.map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      operation: r.operation,
      ticketKey: r.ticket?.jiraIssueKey || null,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      estimatedCost: r.estimatedCost,
      createdAt: r.createdAt,
    })),
  };
}

module.exports = {
  listProviders,
  listSettings,
  upsertSetting,
  setDefault,
  deleteSetting,
  testConnection,
  listModels,
  resolveForPlanning,
  recordUsage,
  getUsage,
  keyContext,
};
