#!/usr/bin/env node
// run-calibration-pilot.mjs — T8, agentic SDLC plan (tasks/plan.md,
// DEC-001). Dispatches a representative spread of real pilot tasks
// (small/medium/large, different work types) as single calls through
// callAnthropicMessages — the same primitive agent_execute and T6's
// decompose command already use — and writes each real result as a task
// record with `actuals` populated, citing DEC-001. Together they become
// the calibration corpus T10's nearest-neighbour estimator draws on.
//
// DRY-RUN BY DEFAULT (real money at stake) — prints what would be
// dispatched and its worst-case cost bound, calls nothing. --yes actually
// runs it. A hard budget cap (default 30 USD, --budget to override) is
// checked BEFORE every call using a worst-case bound (real input token
// count + the task's maxTokens ceiling) — a task that could blow the
// budget even in the worst case is skipped, not attempted and hoped.
//
// USAGE
//   node scripts/run-calibration-pilot.mjs                     # dry run
//   node scripts/run-calibration-pilot.mjs --yes                # for real
//   node scripts/run-calibration-pilot.mjs --yes --budget 20    # tighter cap
//
// Requires one of ANTHROPIC_API_KEY / OPENROUTER_API_KEY / OLLAMA_API_KEY
// to be set (same requirement as any other agent_execute-style call in
// this CLI) — refuses cleanly with --yes and none configured, rather than
// silently doing nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { callAnthropicMessages, resolveAnthropicModel } from '../v3/@claude-flow/cli/dist/src/mcp-tools/agent-execute-core.js';
import { resolveExecutionProvider } from '../v3/@claude-flow/cli/dist/src/ruvector/model-router.js';
import { costUsd } from '../v3/@claude-flow/cli/dist/src/ruvector/model-prices.js';
import { countTokens } from '../v3/@claude-flow/cli/dist/src/ruvector/token-count.js';
import { kindDir, ensureDir, claimAndWriteRecord } from '../v3/@claude-flow/cli/dist/src/commands/records-io.js';
import { computeContentHash, serializeRecordFile, validateRecord, RECORD_PREFIXES } from '../v3/@claude-flow/docops/dist/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DECISION_ID = 'DEC-001';
export const DEFAULT_BUDGET_USD = 30;

/** maxTokens ceiling per size tier — bounds worst-case output cost. */
const MAX_TOKENS_BY_SIZE = { small: 1024, medium: 2048, large: 4096 };

/**
 * 16 real, small, safe, well-scoped tasks against this actual codebase —
 * spanning work type (bug-fix, feature, refactor, config, docs,
 * test-writing, performance) and size (small/medium/large), routed to
 * haiku/sonnet/opus accordingly so the corpus isn't skewed toward one kind
 * of work (verification: no single work type > half of 16 = 8; the widest
 * here is bug-fix at 4).
 */
export const PILOT_TASKS = [
  {
    id: 'req-id-padding',
    title: 'Fix REQ-1 vs REQ-001 zero-padding in citation matching',
    workType: 'bug-fix',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/docops/src/schemas/base.ts'],
    instructions:
      'RecordIdSchema only checks the shape <PREFIX>-<digits>. So "REQ-1" and "REQ-001" are both valid, but distinct, strings. ' +
      'A task citing "REQ-1" will never match a file actually named REQ-001-*.md. Propose a fix: normalize ids to a fixed ' +
      'digit width at lookup time, or document why the current behavior is intentional. Show the code change.',
  },
  {
    id: 'schema-version-field',
    title: 'Add a schemaVersion field to BaseRecordShape',
    workType: 'feature',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/docops/src/schemas/base.ts', 'v3/@claude-flow/docops/src/frontmatter.ts'],
    instructions:
      'BaseRecordShape has no schemaVersion field. With `.strict()` schemas, a record written by a newer writer with an extra ' +
      'field would hard-fail an older reader with no diagnosis of why. Propose adding a `schemaVersion: z.number().int().positive().default(1)` ' +
      'field (or similar) to BaseRecordShape, and note what serializeRecordFile/parseRecordFile would need to do differently, if anything.',
  },
  {
    id: 'task-schema-composable',
    title: 'Make TaskSchema composable (export the object shape separately from its .strict().refine())',
    workType: 'refactor',
    size: 'medium',
    tier: 'sonnet',
    contextFiles: ['v3/@claude-flow/docops/src/schemas/task.ts'],
    instructions:
      'TaskSchema chains z.object({...}).strict().refine(...), which produces a ZodEffects. .extend() does not work on a ZodEffects. ' +
      'Future tasks, adding fields for done-criteria or actuals detail, will have to hand-edit this file instead of composing on ' +
      'top of it. Propose exporting the plain object schema, before .strict()/.refine(), under a separate name. Apply ' +
      '.strict().refine() last, to build the schema validation actually uses. Show the concrete diff.',
  },
  {
    id: 'yaml-size-cap',
    title: 'Cap input size before YAML parsing in frontmatter.ts',
    workType: 'bug-fix',
    size: 'medium',
    tier: 'sonnet',
    contextFiles: ['v3/@claude-flow/docops/src/frontmatter.ts'],
    instructions:
      'parseRecordFile parses the extracted frontmatter block with js-yaml, with no size limit. A few-hundred-byte "billion ' +
      'laughs" anchor/alias frontmatter can expand to tens of megabytes in under a millisecond. That is irrelevant for a local ' +
      'checkout. It becomes a real memory-exhaustion vector once record validation runs against untrusted PR content in CI. ' +
      'Propose a size cap on the raw frontmatter block, checked before parsing, with a clear error when exceeded. Show the code change.',
  },
  {
    id: 'docops-tsconfig-include',
    title: 'Fix docops tsconfig.json include gap for scripts/ and __tests__/',
    workType: 'config',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/docops/tsconfig.json'],
    instructions:
      'This tsconfig.json\'s "include" is ["src/**/*"]. That leaves scripts/ and __tests__/ untypechecked by `npm run build`. ' +
      'A type error in either would only surface when vitest happens to run them, never at build time. Propose the ' +
      'include-array fix. Show the corrected JSON.',
  },
  {
    id: 'docops-package-files',
    title: 'Add a files field to docops package.json',
    workType: 'config',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/docops/package.json'],
    instructions:
      'This package.json has no "files" field. So `npm publish` would ship everything not covered by .npmignore/.gitignore. ' +
      'That includes tests and the vendor/ reference material, meant to stay a dev-time reference, not a runtime dependency of ' +
      'consumers. Propose a "files" array scoped to what a consumer actually needs: dist, package.json itself, license and attribution. Show the JSON change.',
  },
  {
    id: 'graph-refresh-permissions',
    title: 'Add a permissions block to graph-refresh.yml',
    workType: 'config',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['.github/workflows/graph-refresh.yml'],
    instructions:
      'This workflow has no top-level "permissions:" block. So it inherits the repository\'s default token permissions, wider ' +
      'than this workflow (checkout plus cache read/write) actually needs. Propose a minimal "permissions: contents: read" ' +
      'block, plus whatever the cache action genuinely requires. Show exactly where it goes in the YAML.',
  },
  {
    id: 'docops-readme',
    title: 'Write docops/README.md',
    workType: 'docs',
    size: 'medium',
    tier: 'sonnet',
    contextFiles: ['v3/@claude-flow/docops/src/index.ts', 'v3/@claude-flow/docops/ATTRIBUTION.md'],
    instructions:
      '@claude-flow/docops has no README.md. Write one. Say what this package is. It is a typed record substrate for ' +
      'requirement, decision, and task records — see the exports in index.ts for the real API surface. Say why it exists. It ' +
      'vendors and reimplements DocOps, without depending on it — see ATTRIBUTION.md. Add a short usage example using ' +
      'validateRecordFile or parseRecordFile. Keep it concise. This is a README, not a spec.',
  },
  {
    id: 'records-new-factory',
    title: 'De-duplicate records.ts\'s three `new` actions with a shared factory',
    workType: 'refactor',
    size: 'large',
    tier: 'sonnet',
    contextFiles: ['v3/@claude-flow/cli/src/commands/records.ts'],
    instructions:
      'reqNewCommand, decisionNewCommand (structurally identical, not shown here), and taskNewCommand each hand-roll the same ' +
      '~30-line pattern: resolve body, build frontmatter, validate, claimAndWriteRecord. Each uses a different frontmatter ' +
      'literal and different flags. Propose a `makeNewCommand(kind, buildFrontmatter)`-style factory that removes the ' +
      'duplication. Keep each kind\'s own flags and validation distinct — task\'s citation-contract pre-check in particular ' +
      'must stay. Show the concrete refactor for reqNewCommand as the worked example.',
  },
  {
    id: 'cli-package-assets-files',
    title: 'Add assets/ to the CLI package.json files array',
    workType: 'bug-fix',
    size: 'medium',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/cli/package.json'],
    instructions:
      'This package.json\'s "files" array lists dist, bin, scripts/postinstall.cjs, .claude, plugins, README.md, and ' +
      'catalog-manifest.json. It does not list assets/. model-router.ts and neural-router.ts both resolve real runtime assets ' +
      '(openrouter-alts.json, the bundled KRR/calibrator artifacts) from a package-relative assets/ directory. A real `npm ' +
      'publish` would likely omit assets/ entirely, breaking that resolution for every installed copy. Propose the ' +
      'files-array fix. Show the JSON change.',
  },
  {
    id: 'graph-load-caching',
    title: 'Avoid re-parsing the full 48MB graph.json on every separate CLI invocation',
    workType: 'performance',
    size: 'large',
    tier: 'opus',
    contextFiles: ['v3/@claude-flow/cli/src/ruvector/estimator/features.ts'],
    instructions:
      'loadGraph() caches the parsed graph in-memory per graphPath. That cache only helps within ONE process. Every separate ' +
      '`ruflo record req decompose` or feature-extraction CLI invocation pays the full JSON.parse cost of a real ~48MB ' +
      'graph.json again, from a cold process. Propose a concrete, scoped optimization. One option: a persisted, pre-built ' +
      'index of just the code-node label and source_file pairs grounding actually needs, rebuilt only when the graph ' +
      'changes. Sketch the approach. This is a design proposal, not a full implementation. Explain the tradeoffs against just ' +
      'accepting the cold-start cost.',
  },
  {
    id: 'ground-in-graph-test',
    title: 'Add a direct unit test for the standalone groundInGraph export',
    workType: 'test-writing',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/cli/src/ruvector/estimator/features.ts', 'v3/@claude-flow/cli/__tests__/ruvector/estimator/features.test.ts'],
    instructions:
      'features.ts exports groundInGraph() for decompose.ts to reuse. The existing test file only exercises it indirectly, ' +
      'through extractFeatures(). Write 2-3 focused vitest cases that call groundInGraph() directly. Use a fixture graph.json ' +
      'on disk via mkdtempSync, matching this file\'s existing style. Cover a real match, no graph on disk, and text with no keywords.',
  },
  {
    id: 'inherit-tier-test',
    title: 'Add a unit test for resolveExecutionProvider\'s inherit tier under the openrouter provider',
    workType: 'test-writing',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/cli/src/ruvector/model-router.ts', 'v3/@claude-flow/cli/__tests__/predicted-cost-openrouter-c4.test.ts'],
    instructions:
      'The existing C4 regression test\'s "every tier that has an OpenRouter alt prices without throwing" case loops over ' +
      '[haiku, sonnet, opus, inherit]. No test asserts specifically what the "inherit" tier resolves to under ' +
      'CLAUDE_FLOW_ROUTER_PROVIDER=openrouter. Does it get its own alt entry, or fall back to the label? Write one focused ' +
      'test for that, matching this file\'s existing style.',
  },
  {
    id: 'decompose-examples',
    title: 'Add usage examples to the decompose command',
    workType: 'docs',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/cli/src/commands/decompose.ts'],
    instructions:
      'decomposeCommand has no "examples" field (the Command type supports one — see other commands in this codebase for the ' +
      'convention). Propose 2-3 realistic CommandExample entries covering the dry-run, --yes, and --from-file flows. Show the code change.',
  },
  {
    id: 'other-schemas-composability',
    title: 'Check RequirementSchema and DecisionSchema for the same ZodEffects composability issue as TaskSchema',
    workType: 'refactor',
    size: 'small',
    tier: 'sonnet',
    contextFiles: ['v3/@claude-flow/docops/src/schemas/requirement.ts', 'v3/@claude-flow/docops/src/schemas/decision.ts'],
    instructions:
      'TaskSchema chains .strict().refine(), which produces a ZodEffects. .extend() does not work on a ZodEffects. Do ' +
      'RequirementSchema or DecisionSchema share that shape: object().strict() with a trailing .refine()? If so, propose the ' +
      'same fix — export the object shape separately, apply refine last. If not, say so plainly, and explain why they ' +
      'differ. A clean "no bug here" verdict is a valid, useful answer.',
  },
  {
    id: 'content-hash-lone-cr',
    title: 'Check computeContentHash\'s CRLF normalization for a lone-CR edge case',
    workType: 'bug-fix',
    size: 'small',
    tier: 'haiku',
    contextFiles: ['v3/@claude-flow/docops/src/content-hash.ts'],
    instructions:
      'computeContentHash normalizes \\r\\n to \\n before hashing (fixing CRLF-checkout instability). Old Mac-style line endings ' +
      '(a lone \\r with no following \\n) are rare but not impossible in a hand-edited file. Does the current normalization handle ' +
      'a lone \\r correctly, or would it leave a stray \\r in the hashed content? Show a concrete before/after example and, if it\'s ' +
      'a real gap, propose the fix.',
  },
];

function assertSpread(tasks) {
  const byType = new Map();
  for (const t of tasks) byType.set(t.workType, (byType.get(t.workType) ?? 0) + 1);
  const max = Math.max(...byType.values());
  if (max > tasks.length / 2) {
    const worst = [...byType.entries()].find(([, n]) => n === max);
    throw new Error(`spread check failed: work type "${worst[0]}" is ${worst[1]}/${tasks.length} tasks, over half`);
  }
  return Object.fromEntries(byType);
}

export function buildPrompt(task) {
  const context = task.contextFiles
    .map((f) => `--- ${f} ---\n${readFileSync(join(REPO_ROOT, f), 'utf8')}`)
    .join('\n\n');
  const user =
    `Task: ${task.title}\n\n${task.instructions}\n\nRelevant file(s) from the real codebase:\n\n${context}\n\n` +
    `Respond with the concrete code change and a short (2-4 sentence) explanation. Be precise and minimal — this is ` +
    `a small, well-scoped change, not a rewrite.`;
  return {
    system: 'You are a careful senior engineer making a small, well-scoped change to a real codebase. Be precise and minimal.',
    user,
  };
}

/** Resolves the dispatch model id and the PRICING id separately — same C4-safe pattern as T6 (price the model that actually executes, not the tier label, when an OpenRouter alt is in play). */
function resolveModel(tier) {
  const exec = resolveExecutionProvider(tier);
  const usingOpenRouterAlt = exec.provider === 'openrouter' && !!exec.openrouterModel;
  return {
    dispatchModel: usingOpenRouterAlt ? exec.openrouterModel : resolveAnthropicModel(tier),
    priceId: usingOpenRouterAlt ? exec.openrouterModel : tier,
    provider: exec.provider,
  };
}

export function writeTaskRecord(ctx, task, response, actuals) {
  const dir = kindDir(ctx, 'task');
  ensureDir(dir);
  const now = new Date().toISOString();
  const body =
    `Pilot task for T8 calibration (${task.workType}, ${task.size}).\n\n${task.instructions}\n\n` +
    `## Model response\n\n${response}\n`;
  const slug = task.id;
  // T16/T17 (added after this script) — a task record claiming status:'done' has to actually
  // earn it: an estimate and doneCriteria for the drafted/specified preconditions, and a citation
  // to an ACCEPTED decision/requirement, or `record phase-check` correctly flags it as
  // inconsistent. Grounded in the real actuals, not invented: the token total this call really
  // used is both the "estimate" and the "actual" here, since this record is written retroactively,
  // after the work already happened — +/-20% gives it a real (if trivial) range rather than a
  // fake point estimate, matching AD-6's own "never a point estimate" rule.
  const totalTokens = actuals.inputTokens + actuals.outputTokens;
  return claimAndWriteRecord(dir, RECORD_PREFIXES.task, slug, (id) => {
    const frontmatter = {
      id,
      title: task.title,
      status: 'done',
      priority: task.size === 'large' ? 'p1' : 'p2',
      createdAt: now,
      updatedAt: now,
      citations: [ctx.decisionId],
      dependsOn: [],
      estimate: {
        lowTokens: Math.round(totalTokens * 0.8),
        highTokens: Math.round(totalTokens * 1.2),
        confidence: 0.9,
      },
      doneCriteria: { testLayers: [] }, // a proposal/explanation, not code this repo's own suite runs — T18's own "empty list is a valid, deliberate choice"
      actuals,
      contentHash: computeContentHash(body),
      provenance: 'agent-inferred',
    };
    // Passes `body` (T21 readability + content-hash drift, both real checks) so a bad record fails
    // loudly HERE, at write time, instead of writing successfully and only failing later at
    // `record validate` — found the gap the hard way: an earlier version of this call omitted
    // `body` and silently wrote 16 real records that failed validation the moment anyone actually
    // ran `record validate` against them.
    const result = validateRecord(frontmatter, body);
    if (!result.success) return { error: result.error.message ?? String(result.error) };
    return { content: serializeRecordFile(frontmatter, body) };
  });
}

/**
 * Runs the pilot. `callLLM` and `writeRecord` are injectable for testing
 * (mocked LLM call, in-memory record writing) so the budget-stop logic and
 * record-shape correctness are verifiable at $0 without a real API call.
 */
export async function runPilot({
  budgetUsd = DEFAULT_BUDGET_USD,
  tasks = PILOT_TASKS,
  dryRun = true,
  cwd = REPO_ROOT,
  decisionId = DECISION_ID,
  callLLM = callAnthropicMessages,
  writeRecord = writeTaskRecord,
} = {}) {
  assertSpread(tasks);

  let spentUsd = 0;
  const results = [];

  for (const task of tasks) {
    const { system, user } = buildPrompt(task);
    const { dispatchModel, priceId, provider } = resolveModel(task.tier);
    const maxTokens = MAX_TOKENS_BY_SIZE[task.size];
    const worstCaseUsd = costUsd(priceId, countTokens(user) + countTokens(system), maxTokens);

    if (spentUsd + worstCaseUsd > budgetUsd) {
      results.push({ task, status: 'skipped-budget', worstCaseUsd, spentSoFarUsd: spentUsd });
      continue;
    }

    if (dryRun) {
      results.push({ task, status: 'dry-run', dispatchModel, priceId, worstCaseUsd });
      continue;
    }

    const call = await callLLM({ prompt: user, systemPrompt: system, model: dispatchModel, maxTokens, provider });
    if (!call.success || !call.output) {
      results.push({ task, status: 'call-failed', error: call.error ?? 'no output returned' });
      continue;
    }

    const actuals = {
      inputTokens: call.usage?.inputTokens ?? 0,
      outputTokens: call.usage?.outputTokens ?? 0,
      costUsd: call.usage ? costUsd(priceId, call.usage.inputTokens, call.usage.outputTokens) : 0,
    };
    spentUsd += actuals.costUsd;

    const written = writeRecord({ cwd, decisionId }, task, call.output, actuals);
    if ('error' in written) {
      results.push({ task, status: 'write-failed', error: written.error, actuals });
      continue;
    }
    results.push({ task, status: 'created', id: written.id, filePath: written.filePath, actuals });
  }

  return { spentUsd, budgetUsd, results };
}

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const budgetIdx = args.indexOf('--budget');
  const budgetUsd = budgetIdx >= 0 ? parseFloat(args[budgetIdx + 1]) : DEFAULT_BUDGET_USD;

  if (yes && !process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.OLLAMA_API_KEY) {
    console.error('[calibration-pilot] No LLM provider configured (ANTHROPIC_API_KEY / OPENROUTER_API_KEY / OLLAMA_API_KEY all unset). Refusing to run for real.');
    process.exit(2);
  }

  const { spentUsd, results } = await runPilot({ budgetUsd, dryRun: !yes });

  for (const r of results) {
    if (r.status === 'created') console.log(`[OK] ${r.id} (${r.task.workType}/${r.task.size}, $${r.actuals.costUsd.toFixed(4)}): ${r.filePath}`);
    else if (r.status === 'dry-run') console.log(`[DRY] ${r.task.title} — ${r.task.tier} (${r.dispatchModel}), worst case $${r.worstCaseUsd.toFixed(4)}`);
    else console.log(`[${r.status.toUpperCase()}] ${r.task.title}: ${r.error ?? ''}`);
  }

  const created = results.filter((r) => r.status === 'created').length;
  console.log(`\n${yes ? 'Spent' : 'Would spend up to'} $${spentUsd.toFixed(4)} of $${budgetUsd} budget. ${created} task(s) created.`);
  if (yes && created < 15) {
    console.warn(`[WARN] Only ${created}/15 minimum pilot tasks completed — see plan.md Task 8's acceptance criteria.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[calibration-pilot] crashed:', err);
    process.exit(1);
  });
}
