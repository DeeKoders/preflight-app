'use strict';

const { z } = require('zod');

const text = (max = 2000) => z.string().trim().min(1).max(max);
const list = (item, max = 40) => z.array(item).max(max).default([]);

const confidence = z
  .enum(['confirmed', 'inferred', 'unknown'])
  .describe('confirmed = directly supported by retrieved evidence; inferred = reasonable conclusion from evidence; unknown = not verified');

const finding = z.object({
  statement: text(1500),
  confidence,
  evidence: z.string().trim().max(1000).optional().describe('Where this comes from: Jira key/comment, repository file path, or why it is unknown'),
});

const requirement = z.object({
  description: text(1500),
  source: z.enum(['description', 'acceptance_criteria', 'comment', 'linked_issue', 'custom_field', 'attachment', 'inferred']),
  evidence: z.string().trim().max(600).optional(),
});

const task = z.object({
  task: text(400),
  details: z.string().trim().max(1200).optional().describe('Concrete approach, file paths (only if verified) or sub-steps'),
});

const QA_TYPES = ['positive', 'negative', 'edge_case', 'validation', 'permission', 'regression', 'api', 'ui'];
const RISK_CATEGORIES = ['technical', 'business_logic', 'breaking_change', 'dependency', 'data_migration', 'security', 'integration', 'performance'];

const planSchema = z.object({
  businessObjective: text(1500).describe('Why this ticket matters to the business'),
  userProblem: text(1500).describe('The problem the end user experiences'),
  expectedBehavior: text(2000).describe('What should happen once implemented'),
  requirements: z.object({
    functional: z.array(requirement).min(1).max(40),
    nonFunctional: list(requirement),
    acceptanceCriteria: list(
      z.object({
        criterion: text(800),
        status: z.enum(['explicit', 'proposed']).describe('explicit = stated in Jira; proposed = suggested by you, needs confirmation'),
      })
    ),
    constraints: list(text(600)),
  }),
  gaps: z.object({
    missingInformation: list(text(800)),
    ambiguities: list(text(800)),
    conflicts: list(text(800)),
    missingAcceptanceCriteria: z.boolean().describe('True when Jira has no explicit acceptance criteria'),
  }),
  existingSystem: z.object({
    codebaseAnalyzed: z.boolean().describe('True only if repository tools were used successfully in this run'),
    summary: text(2000),
    frontend: list(finding),
    backend: list(finding),
    database: list(finding),
    integrations: list(finding),
    relevantCode: list(
      z.object({
        path: text(400).describe('Exact repository path as returned by a tool. Never invent paths.'),
        description: text(800),
        evidence: text(800).describe('What in the retrieved content supports this'),
        confidence,
      })
    ),
  }),
  impact: z.object({
    components: list(finding),
    services: list(finding),
    api: list(finding),
    database: list(finding),
    integrations: list(finding),
    regressionAreas: list(finding),
  }),
  approach: z.object({
    summary: text(4000),
    rationale: text(2500),
    alternativesConsidered: list(text(800), 10),
  }),
  checklist: z.object({
    preparation: list(task, 25),
    backend: list(task, 40),
    frontend: list(task, 40),
    database: list(task, 25),
    integrations: list(task, 25),
    testing: list(task, 40),
    finalVerification: list(task, 20),
  }),
  qaScenarios: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(20).describe('e.g. QA-01'),
        scenario: text(500),
        preconditions: text(800),
        steps: z.array(text(500)).min(1).max(15),
        expectedResult: text(800),
        type: z.enum(QA_TYPES),
      })
    )
    .min(3)
    .max(60),
  risks: list(
    z.object({
      risk: text(800),
      category: z.enum(RISK_CATEGORIES),
      severity: z.enum(['low', 'medium', 'high']),
      mitigation: text(800),
    })
  ),
  dependencies: list(text(600)),
  assumptions: list(text(800)),
  clarificationQuestions: list(
    z.object({
      question: text(800),
      reason: text(800),
      askWho: z.string().trim().max(120).optional().describe('e.g. Product owner, Reporter, Tech lead'),
    })
  ),
  references: list(
    z.object({
      label: text(300),
      url: z.string().trim().max(1000).optional(),
      type: z.enum(['jira', 'repository', 'documentation', 'other']),
    }),
    60
  ),
  evidence: list(z.object({ finding: text(800), confidence, evidence: text(800) }), 60),
  overallConfidence: z.enum(['low', 'medium', 'high']),
  confidenceRationale: text(1500),
});

function toToolSchema(schema) {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-7' });
  delete json.$schema;
  return json;
}

const PLAN_JSON_SCHEMA = toToolSchema(planSchema);

/** Returns { success, data } or { success:false, issues:[{path,message}] } with readable paths. */
function validatePlan(input) {
  const result = planSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    issues: result.error.issues.slice(0, 30).map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
  };
}

module.exports = { planSchema, PLAN_JSON_SCHEMA, validatePlan, toToolSchema, QA_TYPES, RISK_CATEGORIES };
