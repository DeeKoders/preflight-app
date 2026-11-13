'use strict';

const { z } = require('zod');

const IGNORED_DIR_RE = /(^|\/)(node_modules|vendor|dist|build|out|coverage|\.git|\.next|\.nuxt|target|bin|obj|__pycache__|\.venv|venv|\.idea|\.vscode|Pods)(\/|$)/;
const IGNORED_FILE_RE = /(\.lock$|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|\.min\.(js|css)$|\.map$|\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tar|jar|woff2?|ttf|eot|mp4|mp3|wasm|exe|dll|so|dylib)$)/i;
// Files the agent must never read, even when present in the repository.
const SENSITIVE_FILE_RE = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa.*|id_ed25519.*|\.npmrc|\.pypirc|credentials(\.json)?|secrets?\.(json|ya?ml)|.*\.keystore|\.netrc)$/i;
const DOC_RE = /(^|\/)(readme|contributing|architecture|changelog|design|adr|docs?)(\/|\.|-|_|$)|\.(md|mdx|rst|adoc)$/i;

const MAX_FILE_BYTES = 150 * 1024;
const MAX_LINES = 500;

const repoPath = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .refine((p) => !p.split('/').includes('..') && !p.startsWith('/'), 'Path must be a relative repository path')
  .transform((p) => p.replace(/^\.\//, ''));

async function loadTree(ctx) {
  if (!ctx.github.tree) {
    const res = await ctx.github.client.getTree(ctx.github.repo, ctx.github.ref);
    ctx.github.tree = (res.tree || []).filter((e) => !IGNORED_DIR_RE.test(e.path));
    ctx.github.treeTruncated = Boolean(res.truncated);
  }
  return ctx.github.tree;
}

const blobUrl = (ctx, path) => `https://github.com/${ctx.github.repo}/blob/${encodeURIComponent(ctx.github.ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;

async function readFile(ctx, path, { startLine = 1, endLine } = {}) {
  if (SENSITIVE_FILE_RE.test(path)) throw new Error(`Reading "${path}" is not allowed: it may contain secrets`);
  const tree = await loadTree(ctx);
  const entry = tree.find((e) => e.path === path && e.type === 'blob');
  if (!entry && !ctx.github.treeTruncated) throw new Error(`File "${path}" does not exist in ${ctx.github.repo}. Use get_repository_structure or search_github_code to find real paths.`);
  if (entry?.size > MAX_FILE_BYTES) throw new Error(`File "${path}" is too large (${entry.size} bytes). Search for the relevant symbol instead.`);
  if (IGNORED_FILE_RE.test(path)) throw new Error(`File "${path}" is a generated/binary file and is not useful to read`);
  const res = await ctx.github.client.getContent(ctx.github.repo, path, ctx.github.ref);
  if (Array.isArray(res) || res.type !== 'file') throw new Error(`"${path}" is a directory, not a file`);
  const content = Buffer.from(res.content || '', res.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  if (content.includes('\u0000')) throw new Error(`"${path}" appears to be binary`);
  const lines = content.split('\n');
  const from = Math.max(1, startLine);
  const to = Math.min(lines.length, endLine || from + MAX_LINES - 1, from + MAX_LINES - 1);
  const numbered = lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(4)}| ${l}`)
    .join('\n');
  ctx.observed.filePaths.add(path);
  ctx.observed.seenPaths.add(path);
  return { path, url: blobUrl(ctx, path), totalLines: lines.length, shownLines: `${from}-${to}`, content: numbered };
}

const githubTools = [
  {
    name: 'get_repository_structure',
    category: 'github',
    description:
      'List directories and files in the connected repository (generated/vendor folders excluded). Optionally restrict to a sub-path. Use this to orient yourself before searching or reading files.',
    input: z.object({ path: repoPath.optional(), maxEntries: z.number().int().min(20).max(400).default(250) }),
    async run({ path, maxEntries }, ctx) {
      const tree = await loadTree(ctx);
      const prefix = path ? `${path.replace(/\/$/, '')}/` : '';
      const entries = tree.filter((e) => !prefix || e.path.startsWith(prefix)).filter((e) => !IGNORED_FILE_RE.test(e.path));
      // Breadth-first: shallow paths first so the overview is useful when truncated.
      entries.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
      const shown = entries.slice(0, maxEntries);
      shown.forEach((e) => e.type === 'blob' && ctx.observed.seenPaths.add(e.path));
      return {
        source: `github:${ctx.github.repo}/tree/${path || ''}`,
        summary: `Listed ${shown.length} of ${entries.length} entries in ${ctx.github.repo}${path ? `/${path}` : ''}`,
        data: {
          repository: ctx.github.repo,
          ref: ctx.github.ref,
          path: path || '/',
          totalEntries: entries.length,
          truncated: entries.length > shown.length || ctx.github.treeTruncated,
          entries: shown.map((e) => (e.type === 'tree' ? `${e.path}/` : e.path)),
        },
      };
    },
  },
  {
    name: 'search_github_code',
    category: 'github',
    description:
      'Search the connected repository for code matching keywords (identifiers, route paths, component names, error strings). Returns matching file paths with snippets, plus file paths whose names match the terms.',
    input: z.object({
      query: z.string().trim().min(2).max(120).regex(/^[^:]*$/, 'Do not include search qualifiers; use the extension/path fields'),
      extension: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/).optional(),
      path: repoPath.optional(),
    }),
    async run({ query, extension, path }, ctx) {
      const tree = await loadTree(ctx);
      const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      const pathMatches = tree
        .filter((e) => e.type === 'blob' && !IGNORED_FILE_RE.test(e.path) && !SENSITIVE_FILE_RE.test(e.path))
        .filter((e) => (!path || e.path.startsWith(path)) && (!extension || e.path.endsWith(`.${extension}`)))
        .filter((e) => terms.some((t) => e.path.toLowerCase().includes(t)))
        .slice(0, 25)
        .map((e) => e.path);
      let codeMatches = [];
      let searchError = null;
      try {
        let q = query.replace(/"/g, '');
        if (extension) q += ` extension:${extension}`;
        if (path) q += ` path:${path}`;
        const res = await ctx.github.client.searchCode(ctx.github.repo, q, { perPage: 15 });
        codeMatches = (res.items || [])
          .filter((i) => !SENSITIVE_FILE_RE.test(i.path))
          .map((i) => ({
            path: i.path,
            fragments: (i.text_matches || []).map((m) => String(m.fragment || '').slice(0, 400)).slice(0, 3),
          }));
      } catch (err) {
        // Code search can be rate-limited or unavailable for un-indexed repos; path matches still help.
        searchError = err.message;
      }
      [...pathMatches, ...codeMatches.map((m) => m.path)].forEach((p) => ctx.observed.seenPaths.add(p));
      return {
        source: `github:${ctx.github.repo}/search`,
        summary: `Searched code for "${query}" → ${codeMatches.length} code match(es), ${pathMatches.length} path match(es)`,
        data: { query, codeMatches, pathMatches, ...(searchError ? { codeSearchUnavailable: searchError } : {}) },
      };
    },
  },
  {
    name: 'get_github_file',
    category: 'github',
    description: `Read a file from the connected repository (exact path from the structure or search results). Returns numbered lines; at most ${MAX_LINES} lines per call — use startLine/endLine for large files.`,
    input: z.object({ path: repoPath, startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional() }),
    async run({ path, startLine, endLine }, ctx) {
      const file = await readFile(ctx, path, { startLine, endLine });
      return { source: `github:${ctx.github.repo}/${path}`, summary: `Read ${path} (lines ${file.shownLines} of ${file.totalLines})`, data: file };
    },
  },
  {
    name: 'get_project_documentation',
    category: 'github',
    description:
      'List documentation in the connected repository (README, docs/, ADRs, CONTRIBUTING, architecture notes) and return the README. Pass a path to read a specific documentation file.',
    input: z.object({ path: repoPath.optional() }),
    async run({ path }, ctx) {
      const tree = await loadTree(ctx);
      const docs = tree.filter((e) => e.type === 'blob' && DOC_RE.test(e.path) && !IGNORED_FILE_RE.test(e.path)).map((e) => e.path).slice(0, 80);
      docs.forEach((p) => ctx.observed.seenPaths.add(p));
      let target = path;
      if (!target) target = docs.find((p) => /^readme(\.|$)/i.test(p));
      if (target && !DOC_RE.test(target)) throw new Error(`"${target}" is not a documentation file. Use get_github_file for source files.`);
      const file = target ? await readFile(ctx, target) : null;
      return {
        source: `github:${ctx.github.repo}/docs`,
        summary: file ? `Read documentation ${file.path} (${docs.length} doc file(s) available)` : `Found ${docs.length} documentation file(s)`,
        data: { documentationFiles: docs, file },
      };
    },
  },
];

module.exports = { githubTools, SENSITIVE_FILE_RE, IGNORED_DIR_RE };
