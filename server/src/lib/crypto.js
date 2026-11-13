'use strict';

const crypto = require('node:crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

function parseKey(raw) {
  const value = String(raw || '').trim();
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, 'hex');
  else key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64 hex characters).');
  }
  return key;
}

let cachedKey;
function masterKey() {
  if (!cachedKey) cachedKey = parseKey(env.ENCRYPTION_KEY);
  return cachedKey;
}

/**
 * Encrypts a secret with AES-256-GCM.
 * `context` is bound as Additional Authenticated Data so a ciphertext copied to
 * another user's row (or another purpose) fails authentication on decrypt.
 * Output format: v1.<iv>.<authTag>.<ciphertext> (base64url segments).
 */
function encryptSecret(plaintext, context, key = masterKey()) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('Cannot encrypt an empty secret');
  if (!context) throw new Error('Encryption context is required');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(String(context), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptSecret(payload, context, key = masterKey()) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unsupported ciphertext format');
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAAD(Buffer.from(String(context), 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

/** Masked representation for UI display, e.g. "sk-ant-…a1B2". Never reveals more than 4 trailing chars. */
function maskSecret(secret) {
  const s = String(secret || '');
  if (s.length <= 8) return '••••';
  const prefixMatch = s.match(/^([a-zA-Z]{2,6}[-_](?:[a-zA-Z]{2,6}[-_])?)/);
  const prefix = prefixMatch ? prefixMatch[1].slice(0, 8) : '';
  return `${prefix}••••${s.slice(-4)}`;
}

const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');

/** Deterministic JSON serialisation (sorted keys) used for context hashing. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',')}}`;
}

module.exports = { encryptSecret, decryptSecret, maskSecret, parseKey, sha256, stableStringify };
