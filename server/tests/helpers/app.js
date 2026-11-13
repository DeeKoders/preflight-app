'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');

const app = createApp();

async function registerUser(overrides = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  const body = { name: `User ${n}`, email: `user-${n}@example.com`, password: 'CorrectHorse42', ...overrides };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.data.token;
  const agent = {
    token,
    user: res.body.data.user,
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url, data) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(data),
    put: (url, data) => request(app).put(url).set('Authorization', `Bearer ${token}`).send(data),
    patch: (url, data) => request(app).patch(url).set('Authorization', `Bearer ${token}`).send(data),
    delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
  };
  return agent;
}

module.exports = { app, request, registerUser };
