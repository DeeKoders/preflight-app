'use strict';

const { GitHubIntegration } = require('../../db');
const { encryptSecret, decryptSecret, maskSecret } = require('../../lib/crypto');
const { preconditionRequired, badRequest, IntegrationError } = require('../../lib/errors');
const { GitHubClient } = require('./github.client');

const MAX_SELECTED_REPOS = 25;
const tokenContext = (userId) => `github-token:${userId}`;

let clientFactory = (opts) => new GitHubClient(opts);
const setClientFactory = (fn) => {
  clientFactory = fn;
};

const getIntegration = (userId) => GitHubIntegration.findOne({ where: { userId } });

async function getClient(userId) {
  const integration = await getIntegration(userId);
  if (!integration) throw preconditionRequired('GITHUB_NOT_CONNECTED', 'Connect GitHub on the Integrations page first.');
  const token = decryptSecret(integration.encryptedAccessToken, tokenContext(userId));
  return { integration, client: clientFactory({ token }) };
}

async function connect(userId, { token }) {
  const client = clientFactory({ token });
  const me = await client.getUser();
  const values = {
    userId,
    encryptedAccessToken: encryptSecret(token, tokenContext(userId)),
    tokenMask: maskSecret(token),
    githubUsername: me.login,
    status: 'connected',
    lastError: null,
    connectedAt: new Date(),
    lastValidatedAt: new Date(),
  };
  const existing = await getIntegration(userId);
  const integration = existing ? await existing.update(values) : await GitHubIntegration.create(values);
  return integration.toSafeJSON();
}

async function status(userId) {
  const integration = await getIntegration(userId);
  return integration ? integration.toSafeJSON() : { connected: false };
}

async function test(userId) {
  const { integration, client } = await getClient(userId);
  try {
    const me = await client.getUser();
    await integration.update({ status: 'connected', lastError: null, lastValidatedAt: new Date(), githubUsername: me.login });
    return { ok: true, account: { login: me.login, name: me.name || null } };
  } catch (err) {
    if (err instanceof IntegrationError && err.code === 'GITHUB_AUTH_FAILED') {
      await integration.update({ status: 'invalid', lastError: err.message, lastValidatedAt: new Date() });
    }
    throw err;
  }
}

async function disconnect(userId) {
  await GitHubIntegration.destroy({ where: { userId } });
}

async function listRepositories(userId, { page = 1 } = {}) {
  const { client, integration } = await getClient(userId);
  const repos = await client.listRepos({ page, perPage: 100 });
  const selected = new Set(integration.selectedRepositories || []);
  return {
    repositories: repos.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      description: r.description,
      defaultBranch: r.default_branch,
      language: r.language,
      updatedAt: r.pushed_at || r.updated_at,
      url: r.html_url,
      selected: selected.has(r.full_name),
    })),
    page,
    hasMore: repos.length === 100,
  };
}

/** Saves which repositories the agent may read. Each one is verified as accessible. */
async function updateRepositories(userId, { selectedRepositories, defaultRepository }) {
  const { client, integration } = await getClient(userId);
  const unique = [...new Set(selectedRepositories)];
  if (unique.length > MAX_SELECTED_REPOS) throw badRequest(`Select at most ${MAX_SELECTED_REPOS} repositories`);
  if (defaultRepository && !unique.includes(defaultRepository)) throw badRequest('The default repository must be one of the selected repositories');
  await Promise.all(unique.map((r) => client.getRepo(r)));
  await integration.update({ selectedRepositories: unique, defaultRepository: defaultRepository || unique[0] || null });
  return integration.toSafeJSON();
}

/** Ensures the repository is one the user explicitly selected (agent permission boundary). */
async function assertSelectedRepository(userId, fullName) {
  const integration = await getIntegration(userId);
  if (!integration || !(integration.selectedRepositories || []).includes(fullName)) {
    throw badRequest('That repository is not one of your selected GitHub repositories');
  }
  return integration;
}

module.exports = {
  connect,
  status,
  test,
  disconnect,
  listRepositories,
  updateRepositories,
  assertSelectedRepository,
  getClient,
  setClientFactory,
  tokenContext,
};
