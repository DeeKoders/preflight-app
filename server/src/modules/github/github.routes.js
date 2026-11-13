'use strict';

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { credentialTestLimiter } = require('../../middleware/rateLimits');
const service = require('./github.service');
const { REPO_RE } = require('./github.client');

const repoName = z.string().trim().regex(REPO_RE, 'Use the owner/name format');

const integrationRouter = express.Router();
integrationRouter.use(requireAuth);
integrationRouter.post(
  '/connect',
  credentialTestLimiter,
  validate({ body: z.object({ token: z.string().trim().min(20, 'Token looks too short').max(512) }) }),
  async (req, res) => {
    res.status(201).json({ data: await service.connect(req.user.id, req.valid.body) });
  }
);
integrationRouter.get('/status', async (req, res) => {
  res.json({ data: await service.status(req.user.id) });
});
integrationRouter.post('/test', credentialTestLimiter, async (req, res) => {
  res.json({ data: await service.test(req.user.id) });
});
integrationRouter.put(
  '/repositories',
  validate({ body: z.object({ selectedRepositories: z.array(repoName).max(25), defaultRepository: repoName.nullable().optional() }) }),
  async (req, res) => {
    res.json({ data: await service.updateRepositories(req.user.id, req.valid.body) });
  }
);
integrationRouter.delete('/', async (req, res) => {
  await service.disconnect(req.user.id);
  res.status(204).end();
});

const githubRouter = express.Router();
githubRouter.use(requireAuth);
githubRouter.get('/repositories', validate({ query: z.object({ page: z.coerce.number().int().min(1).max(50).default(1) }) }), async (req, res) => {
  res.json({ data: await service.listRepositories(req.user.id, req.valid.query) });
});

module.exports = { integrationRouter, githubRouter };
