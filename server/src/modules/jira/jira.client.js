'use strict';

const axios = require('axios');
const env = require('../../config/env');
const { IntegrationError, badRequest } = require('../../lib/errors');

const SERVICE = 'jira';
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 10_000;

/**
 * Normalises and validates a Jira Cloud site URL. Only https URLs on an
 * allow-listed host suffix are accepted, which prevents the server from being
 * used to make requests to arbitrary hosts (SSRF).
 */
function normalizeSiteUrl(input, allowedSuffixes = env.jiraAllowedHostSuffixes) {
  let raw = String(input || '').trim();
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('Enter a valid Jira Cloud site URL, e.g. https://your-team.atlassian.net');
  }
  if (url.protocol !== 'https:') throw badRequest('Jira site URL must use https');
  if (url.username || url.password) throw badRequest('Jira site URL must not contain credentials');
  if (url.port && url.port !== '443') throw badRequest('Custom ports are not supported for Jira Cloud');
  const host = url.hostname.toLowerCase();
  const allowed = allowedSuffixes.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
  if (!allowed) {
    throw badRequest(
      `Only Jira Cloud sites are supported (${allowedSuffixes.join(', ')}). Jira Server/Data Center is not supported in this version.`
    );
  }
  return `https://${host}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(headers) {
  const value = headers?.['retry-after'];
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function mapError(err) {
  if (err instanceof IntegrationError) return err;
  const status = err.response?.status;
  const jiraMessages = [
    ...(err.response?.data?.errorMessages || []),
    ...Object.values(err.response?.data?.errors || {}),
  ]
    .filter((m) => typeof m === 'string')
    .join(' ')
    .slice(0, 300);

  if (!err.response) {
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(err.code)) {
      return new IntegrationError({ service: SERVICE, code: 'JIRA_UNREACHABLE', message: 'Could not reach the Jira site. Check the site URL.', status: 502 });
    }
    if (['ECONNABORTED', 'ETIMEDOUT'].includes(err.code)) {
      return new IntegrationError({ service: SERVICE, code: 'JIRA_TIMEOUT', message: 'Jira did not respond in time. Please try again.', status: 504, retryable: true });
    }
    return new IntegrationError({ service: SERVICE, code: 'JIRA_NETWORK_ERROR', message: 'A network error occurred while contacting Jira.', status: 502, retryable: true });
  }
  if (status === 401) {
    return new IntegrationError({
      service: SERVICE,
      code: 'JIRA_AUTH_FAILED',
      message: 'Jira rejected the credentials. The email or API token is invalid, expired or revoked.',
      status: 401,
      upstreamStatus: status,
    });
  }
  if (status === 403) {
    return new IntegrationError({
      service: SERVICE,
      code: 'JIRA_FORBIDDEN',
      message: `Your Jira account does not have permission for this action.${jiraMessages ? ` (${jiraMessages})` : ''}`,
      status: 403,
      upstreamStatus: status,
    });
  }
  if (status === 404) {
    return new IntegrationError({
      service: SERVICE,
      code: 'JIRA_NOT_FOUND',
      message: 'The Jira resource was not found or you do not have permission to view it.',
      status: 404,
      upstreamStatus: status,
    });
  }
  if (status === 429) {
    return new IntegrationError({
      service: SERVICE,
      code: 'JIRA_RATE_LIMITED',
      message: 'Jira rate limit reached. Please wait a moment and retry.',
      status: 429,
      retryable: true,
      retryAfterMs: retryAfterMs(err.response.headers) ?? 30_000,
      upstreamStatus: status,
    });
  }
  if (status === 400) {
    return new IntegrationError({
      service: SERVICE,
      code: 'JIRA_BAD_REQUEST',
      message: `Jira could not process the request.${jiraMessages ? ` ${jiraMessages}` : ''}`,
      status: 400,
      upstreamStatus: status,
    });
  }
  return new IntegrationError({
    service: SERVICE,
    code: 'JIRA_UNAVAILABLE',
    message: `Jira returned an unexpected error (HTTP ${status}).`,
    status: 502,
    retryable: status >= 500,
    upstreamStatus: status,
  });
}

class JiraClient {
  constructor({ siteUrl, email, apiToken, httpClient }) {
    if (!siteUrl || !email || !apiToken) throw new Error('JiraClient requires siteUrl, email and apiToken');
    this.siteUrl = siteUrl;
    this.http =
      httpClient ||
      axios.create({
        baseURL: siteUrl,
        timeout: 20_000,
        maxRedirects: 0,
        auth: { username: email, password: apiToken },
        headers: { Accept: 'application/json', 'User-Agent': 'Preflight/1.0' },
        maxContentLength: 10 * 1024 * 1024,
      });
  }

  async request(config, attempt = 0) {
    try {
      const res = await this.http.request(config);
      return res.data;
    } catch (err) {
      const mapped = mapError(err);
      if (mapped.code === 'JIRA_RATE_LIMITED' && attempt < MAX_RATE_LIMIT_RETRIES && mapped.retryAfterMs <= MAX_RETRY_WAIT_MS) {
        await sleep(mapped.retryAfterMs + Math.floor(Math.random() * 250));
        return this.request(config, attempt + 1);
      }
      throw mapped;
    }
  }

  issueUrl(key) {
    return `${this.siteUrl}/browse/${encodeURIComponent(key)}`;
  }

  getMyself() {
    return this.request({ method: 'GET', url: '/rest/api/3/myself' });
  }

  /** Enhanced JQL search (token-based pagination). */
  searchIssues({ jql, fields, maxResults = 25, nextPageToken, expand }) {
    const data = { jql, maxResults, fields };
    if (nextPageToken) data.nextPageToken = nextPageToken;
    if (expand) data.expand = expand;
    return this.request({ method: 'POST', url: '/rest/api/3/search/jql', data });
  }

  async approximateCount(jql) {
    const data = await this.request({ method: 'POST', url: '/rest/api/3/search/approximate-count', data: { jql } });
    return typeof data?.count === 'number' ? data.count : null;
  }

  getIssue(key, { fields = '*all', expand = 'names' } = {}) {
    return this.request({
      method: 'GET',
      url: `/rest/api/3/issue/${encodeURIComponent(key)}`,
      params: { fields, expand },
    });
  }

  getComments(key, { maxResults = 50, startAt = 0 } = {}) {
    return this.request({
      method: 'GET',
      url: `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
      params: { maxResults, startAt, orderBy: '-created' },
    });
  }

  getRemoteLinks(key) {
    return this.request({ method: 'GET', url: `/rest/api/3/issue/${encodeURIComponent(key)}/remotelink` });
  }

  getProject(keyOrId) {
    return this.request({
      method: 'GET',
      url: `/rest/api/3/project/${encodeURIComponent(keyOrId)}`,
      params: { expand: 'description,lead,issueTypes' },
    });
  }

  getProjectComponents(keyOrId) {
    return this.request({ method: 'GET', url: `/rest/api/3/project/${encodeURIComponent(keyOrId)}/components` });
  }

  /**
   * Downloads attachment bytes. `redirect=false` makes Jira stream the content
   * directly instead of redirecting to its media host. Caller enforces type limits.
   */
  async getAttachmentContent(id, maxBytes) {
    const data = await this.request({
      method: 'GET',
      url: `/rest/api/3/attachment/content/${encodeURIComponent(id)}`,
      params: { redirect: false },
      responseType: 'arraybuffer',
      maxContentLength: maxBytes,
      headers: { Accept: '*/*' },
    });
    return Buffer.from(data);
  }
}

module.exports = { JiraClient, normalizeSiteUrl, mapJiraError: mapError };
