'use strict';

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { credentialTestLimiter } = require('../../middleware/rateLimits');
const service = require('./ai.service');
const { PROVIDER_IDS } = require('./providers');

const provider = z.enum(PROVIDER_IDS);
const model = z.string().trim().min(1, 'Select a model').max(120).regex(/^[A-Za-z0-9._:/-]+$/, 'Invalid model id');
const apiKey = z.string().trim().min(10, 'API key looks too short').max(512);
const idParams = z.object({ id: z.string().uuid() });

const router = express.Router();
router.use(requireAuth);

router.get('/providers', (_req, res) => {
  res.json({ data: service.listProviders() });
});

router.get('/settings', async (req, res) => {
  res.json({ data: await service.listSettings(req.user.id) });
});

router.post(
  '/settings',
  credentialTestLimiter,
  validate({ body: z.object({ provider, model, apiKey: apiKey.optional(), isDefault: z.boolean().optional() }) }),
  async (req, res) => {
    res.status(201).json({ data: await service.upsertSetting(req.user.id, req.valid.body) });
  }
);

router.post(
  '/settings/test',
  credentialTestLimiter,
  validate({
    body: z
      .object({ settingId: z.string().uuid().optional(), provider: provider.optional(), apiKey: apiKey.optional(), model: model.optional() })
      .refine((b) => b.settingId || (b.provider && b.apiKey && b.model), 'Provide settingId, or provider + apiKey + model'),
  }),
  async (req, res) => {
    res.json({ data: await service.testConnection(req.user.id, req.valid.body) });
  }
);

router.post(
  '/models',
  credentialTestLimiter,
  validate({
    body: z
      .object({ settingId: z.string().uuid().optional(), provider: provider.optional(), apiKey: apiKey.optional() })
      .refine((b) => b.settingId || (b.provider && b.apiKey), 'Provide settingId, or provider + apiKey'),
  }),
  async (req, res) => {
    res.json({ data: await service.listModels(req.user.id, req.valid.body) });
  }
);

router.post('/settings/:id/default', validate({ params: idParams }), async (req, res) => {
  res.json({ data: await service.setDefault(req.user.id, req.valid.params.id) });
});

router.delete('/settings/:id', validate({ params: idParams }), async (req, res) => {
  await service.deleteSetting(req.user.id, req.valid.params.id);
  res.status(204).end();
});

router.get('/usage', validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }), async (req, res) => {
  res.json({ data: await service.getUsage(req.user.id, req.valid.query) });
});

module.exports = router;
