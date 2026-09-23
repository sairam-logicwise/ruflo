/**
 * records-io.ts — storage helpers shared by `records.ts` (T4) and
 * `decompose.ts` (T6): resolving a record kind's directory, id-race-safe
 * writing, id lookup, slugging, and validation-error formatting.
 *
 * Split out of records.ts so decompose.ts can reuse these without a
 * circular import (decompose.ts needs records.ts's writing primitives;
 * records.ts would need decompose.ts's Command to wire in the `decompose`
 * subcommand — this module has no dependency on either, so both can import
 * it cleanly).
 *
 * @module commands/records-io
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { CommandContext } from '../types.js';
import { parseRecordFile, serializeRecordFile, validateRecord, type RecordKind, type CitationAcceptance, type Task, type TransitionResult, type Actuals, type VerificationReceipt } from '@claude-flow/docops';
import type { RepairLoopResult } from '../ruvector/repair-loop.js';
import type { TestRunResult } from '../ruvector/test-runner.js';

const KIND_DIR: Record<RecordKind, string> = {
  requirement: 'requirements',
  decision: 'decisions',
  task: 'tasks',
};

export function kindDir(ctx: CommandContext, kind: RecordKind): string {
  return join(ctx.cwd, 'docs', KIND_DIR[kind]);
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function listRecordFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

/** Next `<PREFIX>-<NNN>` id, scanning existing filenames for the current max. */
function nextId(dir: string, prefix: string): string {
  const re = new RegExp(`^${prefix}-(\\d+)`);
  let max = 0;
  for (const f of listRecordFiles(dir)) {
    const m = f.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

const MAX_ID_CLAIM_ATTEMPTS = 20;

/**
 * Claim the next id and write a new record file, retrying on a lost race
 * (review-2026-09-21.md, Important 10): `nextId()` reads the directory,
 * then a plain `writeFileSync` would clobber — two agents creating
 * requirements in parallel (a documented workflow for this CLI) could
 * compute the same id, and the second would silently destroy the first's
 * file. `{ flag: 'wx' }` (O_EXCL) makes a same-id collision throw EEXIST
 * instead of overwriting; on that, recompute the id against the now-
 * current directory listing and try again.
 *
 * `buildContent(id)` receives the CANDIDATE id — the caller needs it to
 * build the frontmatter (the `id` field itself) — and returns the
 * serialized file content, or a `{ error }` to refuse the write entirely
 * (a content problem, not an id collision — not worth retrying).
 */
export function claimAndWriteRecord(
  dir: string,
  prefix: string,
  slug: string,
  buildContent: (id: string) => { content: string } | { error: string },
): { id: string; filePath: string } | { error: string } {
  for (let attempt = 0; attempt < MAX_ID_CLAIM_ATTEMPTS; attempt++) {
    const id = nextId(dir, prefix);
    const built = buildContent(id);
    if ('error' in built) return built;

    const filePath = join(dir, `${id}-${slug}.md`);
    try {
      writeFileSync(filePath, built.content, { encoding: 'utf8', flag: 'wx' });
      return { id, filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue; // lost the race — retry with a fresh id
      throw err;
    }
  }
  return { error: `could not claim a new ${prefix}- id after ${MAX_ID_CLAIM_ATTEMPTS} attempts — too much concurrent contention` };
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'untitled';
}

export function findRecordPath(dir: string, id: string): string | undefined {
  const match = listRecordFiles(dir).find((f) => f === `${id}.md` || f.startsWith(`${id}-`));
  return match ? join(dir, match) : undefined;
}

export function splitList(value: unknown): string[] {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Duck-typed: works for a ZodError without importing zod's type into this package. */
export function formatValidationError(error: Error): string {
  // Duck-typed to ZodError's shape specifically — a real bug found by
  // running the real compiled CLI, not by any unit test: docops's
  // ReadabilityError (T21) ALSO carries an `issues` array (its own shape:
  // {rule, sentence, message}, no `path`), so the old check
  // (`Array.isArray(issues)` alone) matched it too and then crashed on
  // `i.path.join(...)` with `path` undefined. Checking that each issue
  // actually HAS a `path` array is what makes this genuinely Zod-shaped,
  // not just "an array called issues".
  const issues = (error as { issues?: unknown }).issues;
  if (Array.isArray(issues) && issues.every((i) => i && Array.isArray((i as { path?: unknown }).path))) {
    return (issues as Array<{ path: Array<string | number>; message: string }>)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }
  return error.message;
}

/**
 * Turns a state-machine `TransitionResult` into the frontmatter patch that
 * should be written back to a task record — T19's `task-verify.ts` and
 * T20's `task-repair.ts` both end in exactly this write, so it lives here
 * once rather than twice. Clears any prior `blocked` on success (a fresh
 * pass supersedes an old diagnosis); on failure, `blocked` IS the new
 * diagnosis, replacing whatever was there before.
 */
export function applyTaskTransition(
  frontmatter: Record<string, unknown>,
  transition: TransitionResult,
): Record<string, unknown> {
  const newFrontmatter: Record<string, unknown> = { ...frontmatter, updatedAt: new Date().toISOString() };
  if (transition.ok) {
    newFrontmatter.status = transition.to;
    delete newFrontmatter.blocked;
  } else {
    newFrontmatter.status = 'blocked';
    newFrontmatter.blocked = transition.blocked;
  }
  return newFrontmatter;
}

/**
 * T13: turns a repair loop's real spend into an `Actuals` patch —
 * `task-repair.ts` and `run.ts`'s repair branch both end a repair attempt
 * this same way, so it lives here once. Real cost with no real token data
 * happens: `RepairAttemptResult`'s own doc explains why `inputTokens`/
 * `outputTokens` are optional (a round that failed before producing usage
 * — `tdd-repair-unavailable`, a config error — has nothing to report).
 * Returns `undefined` rather than `{inputTokens: 0, outputTokens: 0,
 * costUsd}` in that case — a real, nonzero cost with fabricated zero
 * tokens would teach the estimator (T10) a wrong, too-cheap association,
 * the same reasoning corpus.ts's own Important-7 exclusion already
 * applies. Also `undefined` for a dry run (`attempts.length === 0`,
 * nothing was ever spent) — there is nothing to record either way.
 */
export function buildRepairActuals(repairResult: RepairLoopResult): Actuals | undefined {
  if (repairResult.totalInputTokens === undefined || repairResult.totalOutputTokens === undefined) return undefined;
  return {
    inputTokens: repairResult.totalInputTokens,
    outputTokens: repairResult.totalOutputTokens,
    costUsd: repairResult.totalCostUsd,
    // Review #3, C3/Important 11: real repair spend is measured, never a
    // proxy — plan.model is the actual tier this round billed against
    // (structurally always set alongside real usage; the fallback is
    // defensive typing, not a reachable path).
    source: 'measured',
    priceModel: repairResult.plan?.model ?? 'unknown',
  };
}

/**
 * Review #3, C1: turns a real `runTests()`/`verifyTask()` result into the
 * receipt persisted on the record — `task-verify.ts`, `task-repair.ts`
 * (after a re-verify), and `run.ts`'s verifying branch all end a real
 * test run this same way, so it lives here once. `contentHash` is the
 * record's OWN current contentHash, passed in by the caller (not derived
 * here — records-io.ts doesn't read the file a second time) — this is
 * what lets `phase-check.ts` tell "verified against what's on disk right
 * now" from "verified against a body that has since changed".
 */
export function buildVerificationReceipt(testRun: TestRunResult, contentHash: string): VerificationReceipt {
  return {
    command: testRun.command,
    exitCode: testRun.exitCode,
    ...(testRun.coverage !== undefined ? { coverage: testRun.coverage } : {}),
    timestamp: testRun.timestamp,
    gitSha: testRun.gitSha,
    contentHash,
  };
}

/**
 * T16: real evidence for state-machine.ts's `specified` precondition —
 * docops has no filesystem access (AD-1), so THIS is where a task's
 * REQ/DEC citations actually get read and checked against their own
 * `status`. A citation that isn't `REQ-`/`DEC-` prefixed (i.e. another
 * TASK-) is skipped: only requirements and decisions have an acceptance
 * lifecycle at all. A missing file counts as unaccepted too — citing a
 * requirement that no longer exists on disk is exactly the kind of thing
 * this gate exists to catch, not something to silently pass through.
 */
export function checkCitationAcceptance(ctx: CommandContext, task: Task): CitationAcceptance {
  const unacceptedIds: string[] = [];
  for (const id of task.citations) {
    const kind: RecordKind | undefined = id.startsWith('REQ-') ? 'requirement' : id.startsWith('DEC-') ? 'decision' : undefined;
    if (!kind) continue;
    const filePath = findRecordPath(kindDir(ctx, kind), id);
    if (!filePath) { unacceptedIds.push(id); continue; }
    const { frontmatter } = parseRecordFile(readFileSync(filePath, 'utf8'));
    if (frontmatter.status !== 'accepted') unacceptedIds.push(id);
  }
  return { allAccepted: unacceptedIds.length === 0, unacceptedIds };
}

/**
 * T24: promotes a requirement/decision from `draft` to `accepted` — "a
 * human confirms before it counts as authoritative" (the task's own
 * acceptance criterion), general-purpose for any draft record, not only
 * an inferred one (a human-authored draft is just as real a draft).
 * Refuses cleanly on anything already `accepted`/`superseded` rather than
 * silently no-op'ing, same "refuse loud, not silent" convention as
 * task-repair.ts's own state refusals. `confidence`/`provenance` are left
 * untouched — confirming doesn't erase how a record was produced, only
 * that a human has now vouched for it.
 */
export function confirmRecord(ctx: CommandContext, kind: 'requirement' | 'decision', id: string): { ok: true; filePath: string } | { ok: false; error: string } {
  const dir = kindDir(ctx, kind);
  const filePath = findRecordPath(dir, id);
  if (!filePath) return { ok: false, error: `no ${kind} found matching id "${id}" in ${dir}` };

  const raw = readFileSync(filePath, 'utf8');
  const { frontmatter, body, parseError } = parseRecordFile(raw);
  if (parseError) return { ok: false, error: `${filePath} is not valid YAML frontmatter: ${parseError.message}` };

  if (frontmatter.status !== 'draft') {
    return { ok: false, error: `${id} is "${frontmatter.status}", not "draft" — only a draft record can be confirmed` };
  }

  const newFrontmatter: Record<string, unknown> = { ...frontmatter, status: 'accepted', updatedAt: new Date().toISOString() };
  const validated = validateRecord(newFrontmatter, body);
  if (!validated.success) return { ok: false, error: formatValidationError(validated.error) };

  writeFileSync(filePath, serializeRecordFile(newFrontmatter, body), 'utf8');
  return { ok: true, filePath };
}

/**
 * `--body` inline, else `--body-file` on disk, else a bare heading.
 *
 * Strips leading blank lines (matching serializeRecordFile's own trim)
 * before returning — new problem 2, review-2026-09-22.md: contentHash was
 * computed from this body BEFORE serializeRecordFile silently trimmed it
 * for the file it actually wrote, so a --body-file starting with a blank
 * line failed its own hash check the moment it was created. Trimming here,
 * once, keeps every caller's `computeContentHash(body)` and
 * `serializeRecordFile(frontmatter, body)` looking at identical content.
 */
export function resolveBody(ctx: CommandContext, fallbackTitle: string): string {
  const inline = (ctx.flags.body as string | undefined);
  if (inline) return (inline.endsWith('\n') ? inline : `${inline}\n`).replace(/^\n+/, '');
  const bodyFileFlag = (ctx.flags.bodyFile as string | undefined) ?? (ctx.flags['body-file'] as string | undefined);
  if (bodyFileFlag) {
    const path = isAbsolute(bodyFileFlag) ? bodyFileFlag : join(ctx.cwd, bodyFileFlag);
    return readFileSync(path, 'utf8').replace(/^\n+/, '');
  }
  return `# ${fallbackTitle}\n`;
}
