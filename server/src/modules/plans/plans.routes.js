'use strict';

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { planningLimiter } = require('../../middleware/rateLimits');
const { ISSUE_KEY_RE } = require('../jira/jql');
const { REPO_RE } = require('../github/github.client');
const service = require('./plans.service');

const router = express.Router();
router.use(requireAuth);

const idParams = z.object({ id: z.string().uuid() });
// repository: omitted = use default repo; null = Jira-only (no codebase analysis).
const runOptions = {
  aiSettingId: z.string().uuid().optional(),
  repository: z.string().trim().regex(REPO_RE).nullable().optional(),
};

router.post(
  '/',
  planningLimiter,
  validate({ body: z.object({ issueKey: z.string().trim().regex(ISSUE_KEY_RE, 'Invalid Jira issue key').transform((k) => k.toUpperCase()), ...runOptions }) }),
  async (req, res) => {
    res.status(202).json({ data: await service.startPlanning(req.user.id, req.valid.body) });
  }
);

router.get(
  '/',
  validate({
    query: z.object({
      q: z.string().trim().max(200).optional(),
      freshness: z.enum(['stale', 'fresh', 'failed']).optional(),
      provider: z.enum(['anthropic', 'openai', 'gemini']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(5).max(100).default(20),
    }),
  }),
  async (req, res) => {
    res.json({ data: await service.listPlans(req.user.id, req.valid.query) });
  }
);

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json({ data: await service.getPlan(req.user.id, req.valid.params.id) });
});

router.get('/:id/versions', validate({ params: idParams }), async (req, res) => {
  res.json({ data: await service.listVersions(req.user.id, req.valid.params.id) });
});

router.get(
  '/:id/versions/:version',
  validate({ params: z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) }) }),
  async (req, res) => {
    res.json({ data: await service.getVersion(req.user.id, req.valid.params.id, req.valid.params.version) });
  }
);

router.post('/:id/regenerate', planningLimiter, validate({ params: idParams, body: z.object(runOptions) }), async (req, res) => {
  res.status(202).json({ data: await service.regenerate(req.user.id, req.valid.params.id, req.valid.body) });
});

router.post('/:id/freshness', validate({ params: idParams }), async (req, res) => {
  res.json({ data: await service.checkFreshness(req.user.id, req.valid.params.id) });
});

router.get('/:id/download', validate({ params: idParams }), async (req, res) => {
  const { filename, content } = await service.getDownload(req.user.id, req.valid.params.id);
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.set('Cache-Control', 'no-store');
  res.send(content);
});

module.exports = router;
