'use strict';

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { getOverview } = require('./dashboard.service');

const router = express.Router();
router.use(requireAuth);
router.get('/overview', async (req, res) => {
  res.json({ data: await getOverview(req.user.id) });
});

module.exports = router;
