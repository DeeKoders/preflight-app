'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const env = require('../../config/env');
const { User, RevokedToken } = require('../../db');
const { AppError, conflict, unauthorized } = require('../../lib/errors');

const BCRYPT_ROUNDS = env.isTest ? 4 : 12;
// Pre-computed hash used to equalise timing when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-password', BCRYPT_ROUNDS);

function signToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, jti }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'preflight',
    audience: 'preflight-web',
    algorithm: 'HS256',
  });
  const { exp } = jwt.decode(token);
  return { token, expiresAt: new Date(exp * 1000) };
}

async function register({ name, email, password }) {
  const existing = await User.findOne({ where: { email } });
  if (existing) throw conflict('An account with this email already exists');
  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) });
  return { user, ...signToken(user) };
}

async function login({ email, password }) {
  const user = await User.findOne({ where: { email } });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  return { user, ...signToken(user) };
}

async function verifySession(token) {
  let claims;
  try {
    claims = jwt.verify(token, env.JWT_SECRET, { issuer: 'preflight', audience: 'preflight-web', algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (!claims?.sub || !claims?.jti) return null;
  const [user, revoked] = await Promise.all([User.findByPk(claims.sub), RevokedToken.findByPk(claims.jti)]);
  if (!user || revoked) return null;
  return { user, claims };
}

async function logout(claims) {
  if (!claims?.jti) return;
  await RevokedToken.upsert({ jti: claims.jti, userId: claims.sub, expiresAt: new Date(claims.exp * 1000) });
  // Opportunistic cleanup of expired revocations.
  await RevokedToken.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
}

async function updateProfile(user, { name }) {
  user.name = name;
  await user.save();
  return user;
}

async function changePassword(user, { currentPassword, newPassword }) {
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw unauthorized('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await user.save();
}

module.exports = { register, login, verifySession, logout, signToken, updateProfile, changePassword };
