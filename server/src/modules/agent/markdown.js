'use strict';

/**
 * Deterministically renders a validated plan into the canonical Markdown
 * document. Ticket metadata comes from Jira (not the model).
 */

const cell = (v) =>
  String(v ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/\|/g, '\\|')
    .trim() || '—';

// Prevent model text from injecting headings/HTML that would break document structure.
const inline = (v) =>
  String(v ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/</g, '&lt;')
    .trim();

const block = (v) =>
  String(v ?? '')
    .replace(/</g, '&lt;')
    .replace(/^#{1,6}\s/gm, '')
    .trim();

const CONFIDENCE_LABEL = { confirmed: '✅ Confirmed', inferred: '🔎 Inferred', unknown: '❔ Unknown' };
const QA_LABEL = {
  positive: 'Positive',
  negative: 'Negative',
  edge_case: 'Edge case',
  validation: 'Validation',
  permission: 'Permission',
  regression: 'Regression',
  api: 'API',
  ui: 'UI',
};
const SOURCE_LABEL = {
  description: 'Description',
  acceptance_criteria: 'Acceptance criteria',
  comment: 'Comment',
  linked_issue: 'Linked issue',
  custom_field: 'Custom field',
  attachment: 'Attachment',
  inferred: 'Inferred',
};

function bullets(items, render = inline, empty = '_None identified._') {
  if (!items || !items.length) return empty;
  return items.map((i) => `- ${render(i)}`).join('\n');
}

const findingLine = (f) => `${inline(f.statement)} — _${CONFIDENCE_LABEL[f.confidence] || f.confidence}_${f.evidence ? ` (evidence: ${inline(f.evidence)})` : ''}`;
const requirementLine = (r) => `${inline(r.description)} _(source: ${SOURCE_LABEL[r.source] || r.source}${r.evidence ? ` — ${inline(r.evidence)}` : ''})_`;

function checklist(tasks) {
  if (!tasks || !tasks.length) return '_No tasks in this area._';
  return tasks.map((t) => `- [ ] ${inline(t.task)}${t.details ? `\n  - ${inline(t.details)}` : ''}`).join('\n');
}

function renderPlanMarkdown(plan, { ticket, meta }) {
  const p = plan;
  const lines = [];
  const push = (...s) => lines.push(...s);

  push(`# Development Plan — ${ticket.key}`, '');
  const generated = new Date(meta.generatedAt).toISOString().replace('T', ' ').slice(0, 16);
  push(
    `> **${inline(ticket.summary)}**`,
    '>',
    `> Version ${meta.version}, generated ${generated} UTC with ${meta.providerLabel} (\`${meta.model}\`).  `,
    `> ${
      p.existingSystem.codebaseAnalyzed && meta.repository
        ? `Codebase analysed: \`${meta.repository}\`.`
        : 'Codebase analysis was **unavailable**; technical details are suggestions, not verified against code.'
    }`,
    ''
  );

  push('## 1. Ticket Overview', '');
  push('| Field | Value |', '| --- | --- |');
  push(`| Ticket key | [${ticket.key}](${ticket.url}) |`);
  push(`| Summary | ${cell(ticket.summary)} |`);
  push(`| Type | ${cell(ticket.issueType)} |`);
  push(`| Priority | ${cell(ticket.priority)} |`);
  push(`| Status | ${cell(ticket.status)} |`);
  if (ticket.components?.length) push(`| Components | ${cell(ticket.components.join(', '))} |`);
  if (ticket.labels?.length) push(`| Labels | ${cell(ticket.labels.join(', '))} |`);
  push('');
  push(`**Business objective.** ${inline(p.businessObjective)}`, '');
  push(`**User problem.** ${inline(p.userProblem)}`, '');
  push(`**Expected behavior.** ${inline(p.expectedBehavior)}`, '');

  push('## 2. Requirement Breakdown', '');
  push('### Functional Requirements', '', bullets(p.requirements.functional, requirementLine), '');
  push('### Non-Functional Requirements', '', bullets(p.requirements.nonFunctional, requirementLine), '');
  push('### Acceptance Criteria', '');
  if (p.requirements.acceptanceCriteria.length) {
    push(
      p.requirements.acceptanceCriteria
        .map((a) => `- [ ] ${inline(a.criterion)}${a.status === 'proposed' ? ' _(proposed — needs confirmation)_' : ''}`)
        .join('\n')
    );
  } else push('_No acceptance criteria were found in Jira._');
  push('');
  if (p.requirements.constraints.length) push('### Constraints', '', bullets(p.requirements.constraints), '');

  push('## 3. Requirement Gaps', '');
  if (p.gaps.missingAcceptanceCriteria) push('> ⚠️ **The ticket does not define explicit acceptance criteria.**', '');
  push('### Missing Information', '', bullets(p.gaps.missingInformation), '');
  push('### Ambiguous Requirements', '', bullets(p.gaps.ambiguities), '');
  push('### Conflicting Requirements', '', bullets(p.gaps.conflicts), '');
  push('### Clarification Questions', '', bullets(p.clarificationQuestions, (q) => inline(q.question)), '');

  push('## 4. Existing System Analysis', '');
  if (!p.existingSystem.codebaseAnalyzed) {
    push('> ℹ️ **Codebase analysis was unavailable for this plan.** No repository was connected or no repository content could be retrieved. Statements below are suggestions and assumptions, not verified facts.', '');
  }
  push(block(p.existingSystem.summary), '');
  push('### Frontend', '', bullets(p.existingSystem.frontend, findingLine), '');
  push('### Backend', '', bullets(p.existingSystem.backend, findingLine), '');
  push('### Database', '', bullets(p.existingSystem.database, findingLine), '');
  push('### Integrations', '', bullets(p.existingSystem.integrations, findingLine), '');
  push('### Relevant Existing Code', '');
  if (p.existingSystem.relevantCode.length) {
    push('| File | Why it matters | Evidence | Confidence |', '| --- | --- | --- | --- |');
    p.existingSystem.relevantCode.forEach((r) => {
      const link = meta.repository ? `[\`${r.path}\`](https://github.com/${meta.repository}/blob/${encodeURIComponent(meta.ref || 'HEAD')}/${r.path.split('/').map(encodeURIComponent).join('/')})` : `\`${r.path}\``;
      push(`| ${link} | ${cell(r.description)} | ${cell(r.evidence)} | ${CONFIDENCE_LABEL[r.confidence]} |`);
    });
  } else push(p.existingSystem.codebaseAnalyzed ? '_No specific files were identified._' : '_Not available without codebase access._');
  push('');

  push('## 5. Technical Impact Analysis', '');
  const impact = [
    ['Components affected', p.impact.components],
    ['Services affected', p.impact.services],
    ['API impact', p.impact.api],
    ['Database impact', p.impact.database],
    ['Integration impact', p.impact.integrations],
    ['Potential regression areas', p.impact.regressionAreas],
  ];
  impact.forEach(([title, items]) => push(`### ${title}`, '', bullets(items, findingLine), ''));

  push('## 6. Proposed Implementation Approach', '', block(p.approach.summary), '', `**Why this approach.** ${block(p.approach.rationale)}`, '');
  if (p.approach.alternativesConsidered.length) push('**Alternatives considered**', '', bullets(p.approach.alternativesConsidered), '');

  push('## 7. Implementation Checklist', '');
  [
    ['Preparation', p.checklist.preparation],
    ['Backend', p.checklist.backend],
    ['Frontend', p.checklist.frontend],
    ['Database', p.checklist.database],
    ['Integrations', p.checklist.integrations],
    ['Testing', p.checklist.testing],
    ['Final Verification', p.checklist.finalVerification],
  ].forEach(([title, tasks]) => push(`### ${title}`, '', checklist(tasks), ''));

  push('## 8. QA Test Scenarios', '');
  push('| Scenario ID | Scenario | Preconditions | Steps | Expected result | Type |', '| --- | --- | --- | --- | --- | --- |');
  p.qaScenarios.forEach((s) => {
    const steps = s.steps.map((st, i) => `**${i + 1}.** ${st}`).join(' ');
    push(`| ${cell(s.id)} | ${cell(s.scenario)} | ${cell(s.preconditions)} | ${cell(steps)} | ${cell(s.expectedResult)} | ${QA_LABEL[s.type] || s.type} |`);
  });
  push('');

  push('## 9. Risks and Dependencies', '');
  if (p.risks.length) {
    push('| Risk | Category | Severity | Mitigation |', '| --- | --- | --- | --- |');
    p.risks.forEach((r) => push(`| ${cell(r.risk)} | ${cell(r.category.replace(/_/g, ' '))} | ${cell(r.severity)} | ${cell(r.mitigation)} |`));
  } else push('_No significant risks identified._');
  push('', '### Dependencies', '', bullets(p.dependencies), '');

  push('## 10. Assumptions', '', bullets(p.assumptions), '');

  push('## 11. Clarification Required', '');
  if (p.clarificationQuestions.length) {
    push('| # | Question | Why it matters | Ask |', '| --- | --- | --- | --- |');
    p.clarificationQuestions.forEach((q, i) => push(`| ${i + 1} | ${cell(q.question)} | ${cell(q.reason)} | ${cell(q.askWho || '—')} |`));
  } else push('_No open questions._');
  push('');

  push('## 12. References', '');
  const groups = [
    ['Jira', p.references.filter((r) => r.type === 'jira')],
    ['Repository files', p.references.filter((r) => r.type === 'repository')],
    ['Documentation', p.references.filter((r) => r.type === 'documentation')],
    ['Other', p.references.filter((r) => r.type === 'other')],
  ];
  groups.forEach(([title, refs]) => {
    if (!refs.length) return;
    push(`**${title}**`, '', refs.map((r) => `- ${r.url ? `[${inline(r.label).replace(/[[\]]/g, '')}](${r.url})` : inline(r.label)}`).join('\n'), '');
  });

  push('## 13. Confidence and Evidence', '');
  push(`**Overall confidence: ${p.overallConfidence.toUpperCase()}.** ${inline(p.confidenceRationale)}`, '');
  if (p.evidence.length) {
    push('| Finding | Confidence | Evidence |', '| --- | --- | --- |');
    p.evidence.forEach((e) => push(`| ${cell(e.finding)} | ${CONFIDENCE_LABEL[e.confidence]} | ${cell(e.evidence)} |`));
    push('');
  }
  push(
    '_Legend: ✅ Confirmed — directly supported by retrieved evidence · 🔎 Inferred — reasonable conclusion from evidence · ❔ Unknown — not verified._',
    ''
  );
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

module.exports = { renderPlanMarkdown };
