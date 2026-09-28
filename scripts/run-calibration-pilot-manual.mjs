#!/usr/bin/env node
// run-calibration-pilot-manual.mjs — T8, agentic SDLC plan. Alternative to
// run-calibration-pilot.mjs's real API-key path: this session has no
// ANTHROPIC_API_KEY/OPENROUTER_API_KEY/OLLAMA_API_KEY configured, so instead
// of a script calling out to a real Messages API endpoint, THIS session's
// own model did all 16 pilot tasks directly (real reads of the real context
// files, real proposed fixes) and its responses are hardcoded below.
//
// Two honest differences from the real pipeline, called out explicitly
// (agreed with the user before running this):
//   1. Token counts are a LOCAL tokenizer count (ruvector/token-count.js) on
//      the actual prompt/response text, not a real API response's `usage`
//      object — approximate, not API-metered ground truth.
//   2. Cost is priced against 'anthropic/claude-sonnet-4-6' (the nearest
//      entry in model-prices.ts to this session's real Sonnet-5 model,
//      which has no dedicated price-table entry yet) — every task is
//      labelled by the model that ACTUALLY did the work, never the
//      haiku/sonnet/opus tier PILOT_TASKS originally assigned it to (that
//      would repeat the exact "price the tier label, not the real
//      executing model" bug T12 already fixed once this session).
//
// Usage: node scripts/run-calibration-pilot-manual.mjs [--yes]
// (dry-run by default, same convention as the real script — prints what
// would be written; --yes actually writes the task records.)

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PILOT_TASKS, buildPrompt, writeTaskRecord, DECISION_ID } from './run-calibration-pilot.mjs';
import { countTokens } from '../v3/@claude-flow/cli/dist/src/ruvector/token-count.js';
import { costUsd } from '../v3/@claude-flow/cli/dist/src/ruvector/model-prices.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRICE_ID = 'anthropic/claude-sonnet-4-6'; // nearest available proxy — see header comment

// T21's readability gate applies to every record body — rewritten short and active on purpose,
// not just to satisfy the check, but because it is the same gate every other record here must pass.
const CAVEAT =
  "\n\n---\n_Actuals note: this session's own model did this task directly. No separate API call ran, " +
  "since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local " +
  'tokenizer count on the real prompt and response text. That count is approximate, not an API-metered ' +
  `\`usage\` object. Cost uses ${PRICE_ID} as its price. That is the nearest entry in model-prices.ts to ` +
  "this session's real model, which has no dedicated price-table entry yet. This labels every record by " +
  'the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally ' +
  'assigned to._\n';

/**
 * This session's real responses to each of the 16 pilot tasks — each one a
 * genuine read of the real context file(s) plus a genuine proposed fix,
 * matching the original prompt's own instruction ("the concrete code
 * change and a short 2-4 sentence explanation... precise and minimal").
 */
// Every body below is rewritten short and active on purpose — T21's readability gate applies to
// every task record, including these, and each string here was checked against the real
// validateReadability() before landing (fenced code blocks are exempt as of the T21 fix this
// session made while doing this work; the surrounding prose still has to pass on its own).
const RESPONSES = {
  'req-id-padding': `RecordIdSchema's regex accepts any digit count. So "REQ-1" and "REQ-001" both pass shape validation as distinct strings. findRecordPath then never matches a citation like "REQ-1" against a file named REQ-001-*.md. I confirmed this by reading records-io.ts's own findRecordPath. nextId() always generates ids zero-padded to 3 digits. The real gap sits on the input side. A hand-typed or LLM-proposed citation can skip the padding. Fix the boundary where citations enter the system, not every lookup site:

\`\`\`ts
export function normalizeRecordId(id: string): string {
  const m = id.match(/^(REQ|DEC|TASK)-(\\d+)$/);
  return m ? \`\${m[1]}-\${m[2].padStart(3, '0')}\` : id;
}
\`\`\`

Apply it to splitList(ctx.flags.citations)'s result in taskNewCommand and decisionNewCommand, before validating or writing. This normalizes a citation once at intake. No future lookup site needs to special-case an unpadded id.`,

  'schema-version-field': `BaseRecordShape has no schemaVersion field today. A .strict() schema hard-fails an older reader on any new field a newer writer adds. It raises a generic "unrecognized key" error, not a diagnosable "needs a newer tool version" message. Add:

\`\`\`ts
schemaVersion: z.number().int().positive().default(1),
\`\`\`

to BaseRecordShape. parseRecordFile and serializeRecordFile need no change. An added defaulted field round-trips the same way readabilityStrict already does. This surfaces one real follow-up. records.ts's new commands build the frontmatter object literal by hand. They pass that literal, not validateRecord's default-filled result.data, to serializeRecordFile. So a newly-added defaulted field would validate fine but never reach disk. Fix those call sites to serialize the validated result, or set schemaVersion: 1 explicitly themselves.`,

  'task-schema-composable': `T19 already fixed this (review-2026-09-21.md's own Suggestion). TaskObjectSchema now exports separately as the plain z.object({...}).strict() shape. TaskSchema layers .refine(...) on top of TaskObjectSchema. This lets a future field addition .extend() TaskObjectSchema directly. T19's own blocked field was the fourth one to hit this friction, so the fix landed. This needs no further action — a clean "already handled" verdict.`,

  'yaml-size-cap': `parseRecordFile calls parseYaml on the raw frontmatter block with no size limit. Add a cap, checked before parsing. Report it the same way malformed YAML already is: via parseError, never a thrown exception. This matches the function's own "never throws" contract.

\`\`\`ts
const MAX_FRONTMATTER_BYTES = 64 * 1024; // generous — real records run a few KB

const body = raw.slice(match[0].length);
if (match[1].length > MAX_FRONTMATTER_BYTES) {
  return { frontmatter: {}, body, parseError: new Error(\`frontmatter block exceeds \${MAX_FRONTMATTER_BYTES} bytes (\${match[1].length}) — refusing to parse\`) };
}
try {
  const frontmatter = (parseYaml(match[1], { schema: JSON_SCHEMA }) ?? {}) as Record<string, unknown>;
  ...
\`\`\``,

  'docops-tsconfig-include': `Confirmed: include is ["src/**/*"]. This leaves scripts/ and __tests__/ untypechecked by npm run build (tsc). The naive fix, adding them to include, would break the real build. This tsconfig also sets rootDir: ./src. tsc throws TS6059 ("File is not under rootDir") the moment a file outside src/ joins the same compile. The correct minimal fix adds a separate typecheck-only config, leaving the build one alone:

\`\`\`json
// tsconfig.typecheck.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src/**/*", "scripts/**/*", "__tests__/**/*"]
}
\`\`\`

Run it via tsc -p tsconfig.typecheck.json --noEmit. Add it as a CI or pre-commit step alongside the real npm run build, not instead of it.`,

  'docops-package-files': `Confirmed: no "files" field exists. npm publish would ship everything not excluded by .npmignore or .gitignore. That includes vendor/. ATTRIBUTION.md calls it "reference-only... nothing shells out to it," a dev-time artifact, not a runtime dependency. It also includes __tests__/ and scripts/. Add a files field, matching the sibling @claude-flow/cli package's own convention:

\`\`\`json
"files": ["dist", "!dist/**/*.map", "!dist/**/*.tsbuildinfo", "package.json", "LICENSE", "ATTRIBUTION.md"]
\`\`\``,

  'graph-refresh-permissions': `Confirmed: no top-level permissions block exists. The workflow inherits the repo's default token scope. This job only checks out code and uses actions/cache for restore and save. Neither step needs write access to repo contents. Cache API auth stays separate from the token's contents scope. Add a minimal block, as a top-level key next to name/on/jobs:

\`\`\`yaml
permissions:
  contents: read
\`\`\`

Place it right after the name: graph-refresh line, before on:.`,

  'docops-readme': `Writing v3/@claude-flow/docops/README.md:

\`\`\`markdown
# @claude-flow/docops

Typed record substrate for the agentic SDLC: requirement, decision, and task records.
Each record is one markdown file with YAML frontmatter, under docs/{requirements,decisions,tasks}/.

Adapted from [DocOps](https://github.com/logicwind/DocOps) — see ATTRIBUTION.md.
This package vendors DocOps for reference only. It has no runtime dependency and no Go build.
The three record kinds and the citation contract are reimplemented here, natively, in TypeScript.

## What this exports

See src/index.ts for the full surface. It exports RequirementSchema, DecisionSchema, and
TaskSchema (zod schemas); parseRecordFile, serializeRecordFile, validateRecord, and
validateRecordFile (parse and validate a record file); computeContentHash; and the task
lifecycle state machine (attemptTransition, resumeFromBlocked).

## Usage

Call validateRecordFile(rawFileContent) with a record file's raw text.
It returns { success: true, record } on a valid record, or { success: false, error } otherwise.
\`\`\`

I kept this short. It points at the real API surface in src/index.ts instead of duplicating what the schemas already document inline.`,

  'records-new-factory': `reqNewCommand and decisionNewCommand are structurally identical, about 30 lines each. Both resolve the body, build a frontmatter literal, validate it, and call claimAndWriteRecord. They differ only in the frontmatter literal's extra fields. Worked example, building reqNewCommand from a shared factory:

\`\`\`ts
function makeNewCommand(
  kind: 'requirement' | 'decision',
  prefix: string,
  extraOptions: CommandOption[],
  buildExtraFields: (ctx: CommandContext) => Record<string, unknown>,
): Command {
  return {
    name: 'new',
    description: \`Create a new \${kind} record\`,
    options: [
      { name: 'title', description: \`\${kind} title\`, type: 'string', required: true },
      { name: 'status', description: 'draft|accepted|superseded', type: 'string', default: 'draft' },
      { name: 'body', description: 'Markdown body text', type: 'string' },
      { name: 'body-file', description: 'Read the markdown body from a file', type: 'string' },
      ...extraOptions,
      { name: 'provenance', description: 'human|agent-inferred', type: 'string', default: 'human' },
    ],
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      const title = ctx.flags.title as string | undefined;
      if (!title) { output.printError('Missing required --title'); return { success: false, exitCode: 1 }; }
      const dir = kindDir(ctx, kind);
      ensureDir(dir);
      const body = resolveBody(ctx, title);
      const now = new Date().toISOString();
      const claimed = claimAndWriteRecord(dir, prefix, slugify(title), (id) => {
        const frontmatter = {
          id, title, status: (ctx.flags.status as string) ?? 'draft',
          createdAt: now, updatedAt: now,
          contentHash: computeContentHash(body),
          provenance: (ctx.flags.provenance as string) ?? 'human',
          ...buildExtraFields(ctx),
        };
        const result = validateRecord(frontmatter, body);
        if (!result.success) return { error: formatValidationError(result.error) };
        return { content: serializeRecordFile(frontmatter, body) };
      });
      if ('error' in claimed) { output.printError(\`Refusing to create \${kind}\`, claimed.error); return { success: false, exitCode: 1 }; }
      output.printSuccess(\`Created \${claimed.id}: \${claimed.filePath}\`);
      return { success: true, data: { id: claimed.id, path: claimed.filePath } };
    },
  };
}

const reqNewCommand = makeNewCommand('requirement', RECORD_PREFIXES.requirement,
  [{ name: 'supersedes', description: 'Comma-separated requirement ids this supersedes', type: 'string' }],
  (ctx) => ({ citations: [], supersedes: splitList(ctx.flags.supersedes) }));
\`\`\`

taskNewCommand stays hand-rolled, unchanged. Its citation-contract pre-check refuses before any write, with its own message. That check does not fit this factory's shape without complicating it for one caller.`,

  'cli-package-assets-files': `Confirmed: model-router.ts's loadOpenRouterAlts resolves a real runtime asset from a package-relative assets/ directory. The same convention applies to neural-router.ts. The "files" array omits assets/. A real npm publish would ship without it. That would break asset resolution for every installed copy. It would fall back to {provider:'openrouter'} with no openrouterModel, silently losing the C4 pricing fix. Add "assets" to the array:

\`\`\`json
"files": ["dist", "!dist/**/*.map", "!dist/**/*.tsbuildinfo", "bin", "assets", "scripts/postinstall.cjs", ".claude", "plugins", "README.md", "catalog-manifest.json"]
\`\`\``,

  'graph-load-caching': `This is a design proposal, not a full implementation, as instructed.

loadGraph()'s in-memory graphCache is a module-level Map. It only survives within one process. Every separate CLI invocation cold-starts and pays the full JSON.parse cost of the real graph.json again.

Proposal: persist a small, pre-built grounding index. Store it at graphify-out/grounding-index.json. Hold just {source_file, tokens} pairs for code nodes — the only fields findFilesLikelyTouched actually reads. Key it by a hash of the real graph.json's mtime and size. A staleness check then catches a stale index automatically, rather than trusting it blindly. loadGraph checks for a fresh index first. It loads that, orders of magnitude smaller, instead of the full graph when one exists.

Tradeoffs: this adds a second artifact to keep in sync. The staleness check handles that, not developer discipline. The first invocation after any graph change still pays full cost once, to rebuild the index. Every subsequent cold invocation pays only the tiny index load — the common case, since many separate short-lived CLI calls run in a row.

I considered a long-lived daemon holding the graph in memory across invocations. It solves the same problem. It needs a new IPC and daemon-lifecycle surface, though. That is a materially bigger architectural change. A derived index file already solves the same problem with less new mechanism.`,

  'ground-in-graph-test': `features.ts exports groundInGraph for decompose.ts to reuse. The existing test file only exercises it indirectly, through extractFeatures. Adding 3 focused cases that call groundInGraph directly, reusing this file's existing writeGraph and graphNode helpers:

\`\`\`ts
import { groundInGraph } from '../../../src/ruvector/estimator/features.js';

describe('groundInGraph', () => {
  let repoRoot: string;
  beforeEach(() => { repoRoot = mkdtempSync(join(tmpdir(), 'ground-')); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('matches a real node directly, not just through extractFeatures', () => {
    const graphPath = writeGraph(repoRoot, [graphNode({ label: 'pricing.ts', norm_label: 'pricing.ts', source_file: 'src/pricing.ts' })]);
    expect(groundInGraph('Fix the pricing calculation', graphPath)).toEqual(['src/pricing.ts']);
  });

  it('returns no matches when there is no graph on disk', () => {
    expect(groundInGraph('Fix pricing bugs', join(repoRoot, 'does-not-exist.json'))).toEqual([]);
  });

  it('returns no matches for text with no keywords overlapping any node', () => {
    const graphPath = writeGraph(repoRoot, [graphNode({ label: 'pricing.ts', norm_label: 'pricing.ts', source_file: 'src/pricing.ts' })]);
    expect(groundInGraph('completely unrelated text about weather', graphPath)).toEqual([]);
  });
});
\`\`\``,

  'inherit-tier-test': `I checked the real shipped assets/model-router/openrouter-alts.json. The inherit tier has its own dedicated entry: openrouter_alt is "anthropic/claude-sonnet-4-6". Its own rationale field says why: "inherit is the caller-defined default; we don't override it. Both paths map to Sonnet 4.6." It does not fall back to sonnet's own alt, openai/gpt-4.1. New test, in the existing "resolveExecutionProvider + costUsd composition (C4)" describe block:

\`\`\`ts
it('the inherit tier resolves to its own dedicated OpenRouter alt, not a fallback to sonnet\\'s', () => {
  process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';
  const exec = resolveExecutionProvider('inherit');
  expect(exec.provider).toBe('openrouter');
  expect(exec.openrouterModel).toBe('anthropic/claude-sonnet-4-6');
});
\`\`\``,

  'decompose-examples': `Adding an examples field to decomposeCommand, based on its real --yes and --from-file flags:

\`\`\`ts
examples: [
  { command: 'ruflo record req decompose REQ-001', description: 'Dry-run: print proposed tasks as JSON, write nothing' },
  { command: 'ruflo record req decompose REQ-001 --yes', description: 'Call the LLM and write the proposed tasks as real task records' },
  { command: 'ruflo record req decompose REQ-001 --from-file proposals.json --yes', description: 'Skip the LLM call, write a human-reviewed/edited proposals file instead' },
],
\`\`\`

Place it alongside options in the Command object literal. This matches records.ts's own recordCommand.examples convention.`,

  'other-schemas-composability': `I checked both schemas. Neither has the issue. RequirementSchema and DecisionSchema are each a plain z.object({...}).strict(), with no trailing .refine() at all. Only TaskSchema had one: the citation-contract check. That refine is what produced the un-extendable ZodEffects in the first place. This is a clean "no bug here" verdict. Both schemas already compose directly, as-is.`,

  'content-hash-lone-cr': `Confirmed a real gap. body.replace(/\\r\\n/g, '\\n') only matches a CR immediately followed by an LF. A lone \\r (old Mac-style, no following \\n) does not match this pattern. It stays in the normalized string, and gets hashed with the stray \\r byte still present. Example: "line1\\rline2" (lone CR) normalizes to itself, unchanged, and hashes including the \\r byte. "line1\\nline2" (plain LF, logically the same two lines) hashes differently. The hash stays deterministic for a given file — no drift on its own. But two files a human would call equivalent, line-endings-wise, hash differently. Fix — catch both cases in one pass:

\`\`\`ts
const normalized = body.replace(/\\r\\n|\\r/g, '\\n');
\`\`\``,
};

async function main() {
  const yes = process.argv.includes('--yes');
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  const results = [];

  for (const task of PILOT_TASKS) {
    const response = RESPONSES[task.id];
    if (!response) throw new Error(`no response drafted for pilot task "${task.id}"`);

    const { system, user } = buildPrompt(task);
    const inputTokens = countTokens(system) + countTokens(user);
    const outputTokens = countTokens(response);
    const cost = costUsd(PRICE_ID, inputTokens, outputTokens);
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCostUsd += cost;

    // Review #3, C3/Important 11: this whole script IS the session-as-LLM
    // substitute path — tokenizer-counted, not a real API usage object —
    // so this is genuinely `proxy`, matching the 16 real records already
    // backfilled this way.
    const actuals = { inputTokens, outputTokens, costUsd: cost, source: 'proxy', priceModel: PRICE_ID };

    if (!yes) {
      results.push({ task, status: 'dry-run', actuals });
      continue;
    }

    const written = writeTaskRecord({ cwd: REPO_ROOT, decisionId: DECISION_ID }, task, response + CAVEAT, actuals);
    if ('error' in written) {
      results.push({ task, status: 'write-failed', error: written.error });
      continue;
    }
    results.push({ task, status: 'created', id: written.id, filePath: written.filePath, actuals });
  }

  for (const r of results) {
    if (r.status === 'created') console.log(`[OK] ${r.id} (${r.task.workType}/${r.task.size}): ${r.filePath}`);
    else if (r.status === 'dry-run') console.log(`[DRY] ${r.task.title} — in ${r.actuals.inputTokens}, out ${r.actuals.outputTokens}, $${r.actuals.costUsd.toFixed(4)}`);
    else console.log(`[${r.status.toUpperCase()}] ${r.task.title}: ${r.error ?? ''}`);
  }

  const created = results.filter((r) => r.status === 'created').length;
  console.log(`\n${yes ? 'Created' : 'Would create'} ${yes ? created : results.length} task record(s). Total: in ${totalInputTokens} tok, out ${totalOutputTokens} tok, $${totalCostUsd.toFixed(4)} (approximate — see header comment).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
