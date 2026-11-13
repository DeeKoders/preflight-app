const nock = require('nock');
const { adfToMarkdown } = require('../../src/modules/jira/adf');
const { buildAssignedJql, escapeJqlString } = require('../../src/modules/jira/jql');
const { JiraClient, normalizeSiteUrl, mapJiraError } = require('../../src/modules/jira/jira.client');
const { normalizeIssueDetail } = require('../../src/modules/jira/jira.normalize');
const { rawIssue, SITE } = require('../helpers/fixtures');

describe('ADF → Markdown', () => {
  it('renders paragraphs, marks, lists, code, tables and task lists', () => {
    const md = adfToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goal' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'strong' }] }, { type: 'text', text: ' and ' }, { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const a = 1;' }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [{ type: 'text', text: 'done item' }] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A|B' }] }] }] }] },
      ],
    });
    expect(md).toContain('## Goal');
    expect(md).toContain('**bold** and [link](https://x.dev)');
    expect(md).toContain('1. one');
    expect(md).toContain('```js\nconst a = 1;\n```');
    expect(md).toContain('- [x] done item');
    expect(md).toContain('A\\|B');
  });

  it('drops non-http links (javascript: URLs)', () => {
    const md = adfToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] });
    expect(md).toBe('x');
  });
});

describe('JQL builder', () => {
  it('uses assignee = currentUser() ordered by updated', () => {
    expect(buildAssignedJql()).toBe('assignee = currentUser() ORDER BY updated DESC');
  });

  it('applies whitelisted filters', () => {
    expect(buildAssignedJql({ filter: 'in_progress' })).toContain('statusCategory = "In Progress"');
    expect(buildAssignedJql({ filter: 'done' })).toContain('statusCategory = Done');
    expect(buildAssignedJql({ filter: 'recent' })).toContain('updated >= -7d');
  });

  it('matches issue keys exactly', () => {
    expect(buildAssignedJql({ q: 'proj-12' })).toContain('key = "PROJ-12"');
  });

  it('escapes user input to prevent JQL injection', () => {
    const jql = buildAssignedJql({ q: 'x" OR assignee != currentUser() OR summary ~ "' });
    expect(jql).toContain('\\"');
    expect(jql.startsWith('assignee = currentUser() AND (summary ~ "x\\" OR')).toBe(true);
    expect(escapeJqlString('a\\b')).toBe('a\\\\b');
  });
});

describe('Jira site URL validation (SSRF protection)', () => {
  it('normalises valid Jira Cloud URLs', () => {
    expect(normalizeSiteUrl('acme.atlassian.net')).toBe('https://acme.atlassian.net');
    expect(normalizeSiteUrl('https://Acme.atlassian.net/jira/software')).toBe('https://acme.atlassian.net');
  });
  it.each(['http://acme.atlassian.net', 'https://evil.com', 'https://169.254.169.254', 'https://atlassian.net.evil.com', 'https://user:pw@acme.atlassian.net', 'https://.atlassian.net'])(
    'rejects %s',
    (url) => {
      expect(() => normalizeSiteUrl(url)).toThrow();
    }
  );
});

describe('JiraClient', () => {
  afterEach(() => nock.cleanAll());
  const client = () => new JiraClient({ siteUrl: SITE, email: 'dev@acme.com', apiToken: 'secret-token' });

  it('authenticates with basic auth (email + API token)', async () => {
    const expected = `Basic ${Buffer.from('dev@acme.com:secret-token').toString('base64')}`;
    nock(SITE).get('/rest/api/3/myself').matchHeader('authorization', expected).reply(200, { accountId: 'a1', displayName: 'Dev' });
    await expect(client().getMyself()).resolves.toMatchObject({ accountId: 'a1' });
  });

  it('maps 401 to JIRA_AUTH_FAILED', async () => {
    nock(SITE).get('/rest/api/3/myself').reply(401, {});
    await expect(client().getMyself()).rejects.toMatchObject({ code: 'JIRA_AUTH_FAILED', status: 401 });
  });

  it('maps 403 to JIRA_FORBIDDEN and 404 to JIRA_NOT_FOUND', async () => {
    nock(SITE).get('/rest/api/3/issue/PROJ-1').query(true).reply(403, { errorMessages: ['No browse permission'] });
    await expect(client().getIssue('PROJ-1')).rejects.toMatchObject({ code: 'JIRA_FORBIDDEN' });
    nock(SITE).get('/rest/api/3/issue/PROJ-2').query(true).reply(404, {});
    await expect(client().getIssue('PROJ-2')).rejects.toMatchObject({ code: 'JIRA_NOT_FOUND' });
  });

  it('retries 429 responses honouring Retry-After, then surfaces rate limits', async () => {
    nock(SITE).get('/rest/api/3/myself').reply(429, {}, { 'Retry-After': '0' }).get('/rest/api/3/myself').reply(200, { accountId: 'a1' });
    await expect(client().getMyself()).resolves.toMatchObject({ accountId: 'a1' });
    nock(SITE).get('/rest/api/3/myself').times(3).reply(429, {}, { 'Retry-After': '120' });
    await expect(client().getMyself()).rejects.toMatchObject({ code: 'JIRA_RATE_LIMITED', retryable: true });
  });

  it('uses the enhanced JQL search endpoint with token pagination', async () => {
    nock(SITE)
      .post('/rest/api/3/search/jql', (b) => b.jql === 'assignee = currentUser() ORDER BY updated DESC' && b.nextPageToken === 'tok')
      .reply(200, { issues: [], isLast: true });
    await expect(client().searchIssues({ jql: 'assignee = currentUser() ORDER BY updated DESC', fields: ['summary'], nextPageToken: 'tok' })).resolves.toMatchObject({ isLast: true });
  });

  it('maps network failures', () => {
    expect(mapJiraError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toMatchObject({ code: 'JIRA_UNREACHABLE', retryable: false });
    expect(mapJiraError(Object.assign(new Error('x'), { code: 'ECONNABORTED' }))).toMatchObject({ code: 'JIRA_TIMEOUT', retryable: true });
    expect(mapJiraError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toMatchObject({ code: 'JIRA_NETWORK_ERROR', retryable: true });
    expect(mapJiraError({ response: { status: 503, headers: {}, data: {} } })).toMatchObject({ code: 'JIRA_UNAVAILABLE', retryable: true });
  });
});

describe('issue normalisation', () => {
  it('extracts description, links, parent, attachments and relevant custom fields', () => {
    const d = normalizeIssueDetail(rawIssue(), SITE);
    expect(d).toMatchObject({ key: 'PROJ-1', statusCategory: 'in_progress', priority: 'High', url: `${SITE}/browse/PROJ-1` });
    expect(d.description).toContain('**CSV export**');
    expect(d.parent.key).toBe('PROJ-100');
    expect(d.issueLinks[0]).toMatchObject({ key: 'PROJ-7', relationship: 'relates to' });
    expect(d.attachments[0]).toMatchObject({ id: '500', filename: 'sample.csv' });
    expect(d.customFields).toEqual([expect.objectContaining({ name: 'Acceptance Criteria' })]);
  });
});
