'use strict';

const { redactSecrets } = require('../../lib/redact');

const ISSUE_KEY_GLOBAL_RE = /\b[A-Z][A-Z0-9_]{1,30}-\d{1,9}\b/g;

function deepRedact(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepRedact(v)]));
  return value;
}

/**
 * Post-validation grounding checks. The AI output is never trusted blindly:
 *  - code references must be paths a repository tool actually returned in this run
 *  - "confirmed" code claims require the file to have been read
 *  - codebaseAnalyzed cannot be true when no repository was available / read
 *  - reference URLs are only kept when they point at known, observed locations
 * Returns { plan, notes } where notes describe every adjustment made.
 */
function verifyPlanEvidence(input, { observed, siteUrl, github, ticket }) {
  const plan = deepRedact(JSON.parse(JSON.stringify(input)));
  const notes = [];

  const githubUsed = Boolean(github) && observed.seenPaths.size > 0;
  if (plan.existingSystem.codebaseAnalyzed && !githubUsed) {
    plan.existingSystem.codebaseAnalyzed = false;
    notes.push('Codebase analysis flag was corrected to "not analysed": no repository content was retrieved in this run.');
  }

  // Relevant code: drop unseen paths, cap confidence for unread files.
  plan.existingSystem.relevantCode = plan.existingSystem.relevantCode.filter((ref) => {
    const path = ref.path.replace(/^\.?\//, '').replace(/#.*$/, '');
    if (!observed.seenPaths.has(path)) {
      notes.push(`Removed unverified file reference "${ref.path}" — it was not returned by any repository tool.`);
      return false;
    }
    ref.path = path;
    if (ref.confidence === 'confirmed' && !observed.filePaths.has(path)) {
      ref.confidence = 'inferred';
      notes.push(`Downgraded "${path}" to inferred — the file was listed but its contents were not read.`);
    }
    return true;
  });

  // Without codebase access, nothing about existing code can be "confirmed".
  if (!plan.existingSystem.codebaseAnalyzed) {
    for (const section of ['frontend', 'backend', 'database', 'integrations']) {
      plan.existingSystem[section].forEach((f) => {
        if (f.confidence === 'confirmed' && !/jira|ticket|comment|[A-Z]+-\d+/i.test(f.evidence || '')) {
          f.confidence = 'inferred';
        }
      });
    }
  }

  // References: keep URLs only for the Jira site, the selected repo, or links observed via tools.
  const allowedPrefixes = [siteUrl, github ? `https://github.com/${github.repo}` : null].filter(Boolean).map((p) => p.toLowerCase());
  plan.references = plan.references
    .map((r) => {
      if (!r.url) return r;
      const url = r.url.trim();
      const ok = /^https:\/\//i.test(url) && (allowedPrefixes.some((p) => url.toLowerCase().startsWith(p)) || observed.urls.has(url));
      if (!ok) {
        notes.push(`Removed unverified link from reference "${r.label}".`);
        const { url: _drop, ...rest } = r;
        return rest;
      }
      return { ...r, url };
    })
    .filter((r) => {
      // Jira references must point at issues that were actually seen.
      const keys = (r.label.match(ISSUE_KEY_GLOBAL_RE) || []).concat((r.url || '').match(ISSUE_KEY_GLOBAL_RE) || []);
      if (r.type === 'jira' && keys.length && !keys.some((k) => observed.issueKeys.has(k))) {
        notes.push(`Removed reference to ${keys[0]} — that issue was not retrieved in this run.`);
        return false;
      }
      return true;
    });

  // Ensure canonical references are present (built from real data, not AI output).
  const refUrls = new Set(plan.references.map((r) => r.url).filter(Boolean));
  if (!refUrls.has(ticket.url)) plan.references.unshift({ label: `${ticket.key} — ${ticket.summary}`, url: ticket.url, type: 'jira' });
  for (const path of observed.filePaths) {
    const url = github ? `https://github.com/${github.repo}/blob/${encodeURIComponent(github.ref)}/${path.split('/').map(encodeURIComponent).join('/')}` : null;
    if (url && !refUrls.has(url) && !plan.references.some((r) => r.label.includes(path))) {
      plan.references.push({ label: path, url, type: 'repository' });
    }
  }
  for (const r of plan.references) {
    if (r.type === 'jira' && !r.url) {
      const key = (r.label.match(ISSUE_KEY_GLOBAL_RE) || [])[0];
      if (key && observed.issueKeys.has(key)) r.url = `${siteUrl}/browse/${key}`;
    }
  }

  // Unique QA scenario ids.
  const seen = new Set();
  plan.qaScenarios.forEach((s, i) => {
    if (seen.has(s.id)) s.id = `QA-${String(i + 1).padStart(2, '0')}`;
    seen.add(s.id);
  });

  if (notes.length) plan.assumptions = [...plan.assumptions, ...notes.map((n) => `[Verification] ${n}`)];
  return { plan, notes };
}

module.exports = { verifyPlanEvidence };
