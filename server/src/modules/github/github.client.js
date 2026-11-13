'use strict';

const axios = require('axios');
const env = require('../../config/env');
const { IntegrationError } = require('../../lib/errors');

const SERVICE = 'github';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

function mapError(err) {
  if (err instanceof IntegrationError) return err;
  const res = err.response;
  if (!res) {
    return new IntegrationError({ service: SERVICE, code: 'GITHUB_NETWORK_ERROR', message: 'Could not reach GitHub. Please try again.', status: 502, retryable: true });
  }
  const msg = typeof res.data?.message === 'string' ? res.data.message.slice(0, 200) : '';
  const remaining = res.headers?.['x-ratelimit-remaining'];
  if (res.status === 401) {
    return new IntegrationError({ service: SERVICE, code: 'GITHUB_AUTH_FAILED', message: 'GitHub rejected the token. It may be invalid, expired or revoked.', status: 401 });
  }
  if (res.status === 429 || (res.status === 403 && (remaining === '0' || /rate limit/i.test(msg)))) {
    const reset = Number(res.headers?.['x-ratelimit-reset']);
    const retryAfter = Number(res.headers?.['retry-after']);
    const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Number.isFinite(reset) ? Math.max(0, reset * 1000 - Date.now()) : 60_000;
    return new IntegrationError({ service: SERVICE, code: 'GITHUB_RATE_LIMITED', message: 'GitHub rate limit reached. Please try again later.', status: 429, retryable: true, retryAfterMs });
  }
  if (res.status === 403) {
    return new IntegrationError({ service: SERVICE, code: 'GITHUB_FORBIDDEN', message: `The GitHub token lacks permission for this resource.${msg ? ` (${msg})` : ''}`, status: 403 });
  }
  if (res.status === 404) {
    return new IntegrationError({ service: SERVICE, code: 'GITHUB_NOT_FOUND', message: 'GitHub resource not found or not accessible with this token.', status: 404 });
  }
  if (res.status === 422) {
    return new IntegrationError({ service: SERVICE, code: 'GITHUB_BAD_REQUEST', message: `GitHub could not process the request.${msg ? ` ${msg}` : ''}`, status: 400 });
  }
  return new IntegrationError({ service: SERVICE, code: 'GITHUB_UNAVAILABLE', message: `GitHub returned an unexpected error (HTTP ${res.status}).`, status: 502, retryable: res.status >= 500 });
}

/** Strictly read-only GitHub REST client — only GET requests are ever issued. */
class GitHubClient {
  constructor({ token, httpClient, baseURL = env.GITHUB_API_URL }) {
    if (!token) throw new Error('GitHubClient requires a token');
    this.http =
      httpClient ||
      axios.create({
        baseURL,
        timeout: 20_000,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Preflight/1.0',
        },
        maxContentLength: 20 * 1024 * 1024,
      });
  }

  async get(url, params, extra = {}) {
    try {
      const res = await this.http.request({ method: 'GET', url, params, ...extra });
      return extra.withHeaders ? { data: res.data, headers: res.headers } : res.data;
    } catch (err) {
      throw mapError(err);
    }
  }

  static assertRepo(fullName) {
    if (!REPO_RE.test(String(fullName || ''))) {
      throw new IntegrationError({ service: SERVICE, code: 'GITHUB_BAD_REQUEST', message: 'Invalid repository name. Use the owner/name format.', status: 400 });
    }
    return fullName;
  }

  static encodePath(path) {
    return String(path)
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .map(encodeURIComponent)
      .join('/');
  }

  async getUser() {
    const { data, headers } = await this.get('/user', undefined, { withHeaders: true });
    return { ...data, scopes: headers?.['x-oauth-scopes'] || null };
  }

  listRepos({ page = 1, perPage = 100 } = {}) {
    return this.get('/user/repos', { sort: 'updated', per_page: perPage, page, affiliation: 'owner,collaborator,organization_member' });
  }

  getRepo(fullName) {
    return this.get(`/repos/${GitHubClient.assertRepo(fullName)}`);
  }

  getTree(fullName, ref) {
    return this.get(`/repos/${GitHubClient.assertRepo(fullName)}/git/trees/${encodeURIComponent(ref)}`, { recursive: 1 });
  }

  searchCode(fullName, query, { perPage = 15 } = {}) {
    GitHubClient.assertRepo(fullName);
    return this.get('/search/code', { q: `${query} repo:${fullName}`, per_page: perPage }, { headers: { Accept: 'application/vnd.github.text-match+json' } });
  }

  getContent(fullName, path, ref) {
    return this.get(`/repos/${GitHubClient.assertRepo(fullName)}/contents/${GitHubClient.encodePath(path)}`, ref ? { ref } : undefined);
  }

  getReadme(fullName, ref) {
    return this.get(`/repos/${GitHubClient.assertRepo(fullName)}/readme`, ref ? { ref } : undefined);
  }
}

module.exports = { GitHubClient, mapGitHubError: mapError, REPO_RE };
