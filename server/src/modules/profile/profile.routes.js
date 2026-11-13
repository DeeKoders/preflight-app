'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const authService = require('../auth/auth.service');
const { updateProfileSchema, changePasswordSchema } = require('../auth/auth.schemas');

const router = express.Router();
router.use(requireAuth);

router.patch('/', validate({ body: updateProfileSchema }), async (req, res) => {
  const user = await authService.updateProfile(req.user, req.valid.body);
  res.json({ data: { user: user.toSafeJSON() } });
});

router.post('/password', validate({ body: changePasswordSchema }), async (req, res) => {
  await authService.changePassword(req.user, req.valid.body);
  res.status(204).end();
});

module.exports = router;
