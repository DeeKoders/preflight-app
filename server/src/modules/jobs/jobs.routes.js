'use strict';

const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const service = require('./jobs.service');

const router = express.Router();
router.use(requireAuth);
const idParams = z.object({ id: z.string().uuid() });

router.get(
  '/',
  validate({ query: z.object({ status: z.enum(['active', 'queued', 'running', 'completed', 'failed', 'cancelled']).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }) }),
  async (req, res) => {
    res.json({ data: await service.listJobs(req.user.id, req.valid.query) });
  }
);
router.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json({ data: await service.getJob(req.user.id, req.valid.params.id) });
});
router.post('/:id/cancel', validate({ params: idParams }), async (req, res) => {
  res.json({ data: await service.cancelJob(req.user.id, req.valid.params.id) });
});

module.exports = router;
