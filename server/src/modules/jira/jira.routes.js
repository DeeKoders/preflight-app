'use strict';

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { credentialTestLimiter } = require('../../middleware/rateLimits');
const service = require('./jira.service');
const { ISSUE_KEY_RE } = require('./jql');

const connectSchema = z.object({
  siteUrl: z.string().trim().min(1, 'Site URL is required').max(255),
  email: z.string().trim().toLowerCase().email('Enter the email of your Atlassian account'),
  apiToken: z.string().trim().min(8, 'API token looks too short').max(1024),
});

const listQuery = z.object({
  filter: z.enum(['all', 'in_progress', 'todo', 'done', 'recent']).default('all'),
  q: z.string().trim().max(200).optional(),
  pageToken: z.string().max(2048).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

const keyParams = z.object({ key: z.string().trim().regex(ISSUE_KEY_RE, 'Invalid Jira issue key').transform((k) => k.toUpperCase()) });

// /api/integrations/jira
const integrationRouter = express.Router();
integrationRouter.use(requireAuth);
integrationRouter.post('/connect', credentialTestLimiter, validate({ body: connectSchema }), async (req, res) => {
  res.status(201).json({ data: await service.connect(req.user.id, req.valid.body) });
});
integrationRouter.get('/status', async (req, res) => {
  res.json({ data: await service.status(req.user.id) });
});
integrationRouter.post('/test', credentialTestLimiter, async (req, res) => {
  res.json({ data: await service.test(req.user.id) });
});
integrationRouter.delete('/', async (req, res) => {
  await service.disconnect(req.user.id);
  res.status(204).end();
});

// /api/jira
const jiraRouter = express.Router();
jiraRouter.use(requireAuth);
jiraRouter.get('/tickets', validate({ query: listQuery }), async (req, res) => {
  res.json({ data: await service.listAssigned(req.user.id, req.valid.query) });
});
jiraRouter.post('/tickets/refresh', async (req, res) => {
  res.json({ data: await service.refreshAssigned(req.user.id) });
});
jiraRouter.get('/tickets/:key', validate({ params: keyParams }), async (req, res) => {
  res.json({ data: await service.getTicket(req.user.id, req.valid.params.key) });
});

module.exports = { integrationRouter, jiraRouter };
