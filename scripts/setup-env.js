#!/usr/bin/env node
/**
 * Creates `.env` from `.env.example` if it doesn't exist, then fills in any
 * blank or placeholder secrets (JWT_SECRET, ENCRYPTION_KEY) with strong random
 * values. Existing real values are never overwritten — changing ENCRYPTION_KEY
 * would make already-saved credentials undecryptable.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(examplePath, envPath);
  console.log('Created .env from .env.example');
}

let env = fs.readFileSync(envPath, 'utf8');
const generators = {
  JWT_SECRET: {
    needs: (v) => !v || /change-me/i.test(v) || v.length < 32,
    make: () => crypto.randomBytes(48).toString('base64url'),
  },
  ENCRYPTION_KEY: {
    needs: (v) => !v,
    make: () => crypto.randomBytes(32).toString('base64'),
  },
};

for (const [key, { needs, make }] of Object.entries(generators)) {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const match = env.match(re);
  const current = match ? match[1].trim() : '';
  if (!needs(current)) {
    console.log(`${key} already set — left unchanged`);
    continue;
  }
  const line = `${key}=${make()}`;
  env = match ? env.replace(re, line) : `${env.trimEnd()}\n${line}\n`;
  console.log(`${key} generated`);
}

fs.writeFileSync(envPath, env, { mode: 0o600 });
console.log('.env is ready (git-ignored — never commit it).');
