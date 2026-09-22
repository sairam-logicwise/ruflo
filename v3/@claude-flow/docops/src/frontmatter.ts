/**
 * frontmatter.ts — parse a record file (markdown body + YAML frontmatter)
 * and validate it against the right schema (T3).
 *
 * Records are one file per record, frontmatter + markdown body, which is
 * what makes them "diff and merge sensibly as files in git" (plan.md Task
 * 3 acceptance criterion) — a line-based text format, not a JSON blob.
 *
 * Which schema applies is resolved from the record's own `id` field prefix
 * (REQ-/DEC-/TASK-), not the filename — keeps this module usable on a raw
 * string in a unit test without needing a fake file path.
 *
 * Frontmatter splitting is hand-rolled rather than via `gray-matter`:
 * gray-matter@4.0.3 hard-requires js-yaml v3's `safeLoad` at module-load
 * time, and this workspace's `pnpm.overrides` forces `js-yaml >=4.3.0`
 * (v4 removed `safeLoad`) — gray-matter crashes on import here regardless
 * of any options passed to it. The split itself is a few lines; not worth
 * a dependency that's broken under this workspace's pinned js-yaml.
 *
 * @module frontmatter
 */

import { load as parseYaml, dump as stringifyYaml, JSON_SCHEMA } from 'js-yaml';
import type { z } from 'zod';
import { RequirementSchema } from './schemas/requirement.js';
import { DecisionSchema } from './schemas/decision.js';
import { TaskSchema } from './schemas/task.js';
import type { Requirement } from './schemas/requirement.js';
import type { Decision } from './schemas/decision.js';
import type { Task } from './schemas/task.js';
import { computeContentHash } from './content-hash.js';
import { validateReadability, type ReadabilityIssue } from './validators/readability.js';

export type AnyRecord = Requirement | Decision | Task;

export interface ParsedRecordFile {
  frontmatter: Record<string, unknown>;
  body: string;
  /**
   * Set when the frontmatter block failed to parse as YAML. `frontmatter`
   * is `{}` in that case — a caller that only reads fields (not this flag)
   * would otherwise see "id missing" and report the wrong root cause.
   */
  parseError?: Error;
}

// `(?:\r?\n)+` (one or more full CRLF-or-LF units), not `\r?\n+` (one
// optional \r, then one-or-more bare \n): serializeRecordFile writes a blank
// line after the closing `---` (`---\n\n`, the conventional frontmatter
// separator), but the old `\r?\n?` only consumed the first of those two
// newlines — every parsed body carried a leading blank line the original
// write-time body never had, which content-hash drift detection (Important
// 4, review-2026-09-21.md) then flagged on every single record the CLI ever
// created. Fixed to `\r?\n+`, but that still breaks on CRLF-normalised
// checkouts (`core.autocrlf`): `\r?` binds once, so on `---\r\n\r\n` it
// consumes the first `\r\n` and then `\n+` can't match the leading `\r` of
// the second pair, leaving `\r\n` stuck on the front of the body (B2,
// review-2026-09-22.md — verified: this silently corrupted every hash-
// checked record on a Windows checkout, hard-blocking commits to files a
// contributor never touched). `(?:\r?\n)+` repeats the whole
// optional-CR-then-LF unit, consuming any number of CRLF or LF blank lines
// either way — the true inverse of serialize regardless of line-ending
// convention.
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/;

/**
 * Split a record file's YAML frontmatter from its markdown body. Never
 * throws — malformed YAML is reported via `parseError`, not an exception,
 * so a single broken file can't take down a caller that processes many
 * (the pre-commit hook, `record validate`, `record list`).
 */
export function parseRecordFile(raw: string): ParsedRecordFile {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const body = raw.slice(match[0].length);
  try {
    // JSON_SCHEMA, not the default: js-yaml's default schema auto-detects
    // an ISO-8601-looking scalar as YAML 1.1's `!!timestamp` and returns a
    // native Date — every createdAt/updatedAt in every record silently
    // stopped being a string once js-yaml resolved to a version whose
    // default schema does this (caught by re-running tests after pinning
    // the version below 5.x — see js-yaml version note in this file's
    // header comment). JSON_SCHEMA has no timestamp/binary/merge-key
    // resolution at all, so ISO datetimes stay plain strings regardless
    // of which js-yaml version is installed — the fix isn't "hope the
    // version stays right", it's "don't depend on version-specific
    // default-schema behavior".
    const frontmatter = (parseYaml(match[1], { schema: JSON_SCHEMA }) ?? {}) as Record<string, unknown>;
    return { frontmatter, body };
  } catch (err) {
    return { frontmatter: {}, body, parseError: err instanceof Error ? err : new Error(String(err)) };
  }
}

const SCHEMA_BY_PREFIX: Array<[prefix: string, schema: z.ZodTypeAny]> = [
  ['REQ-', RequirementSchema],
  ['DEC-', DecisionSchema],
  ['TASK-', TaskSchema],
];

/** Thrown (as a Result error, never actually thrown) when `id` doesn't resolve to a known kind. */
export class UnknownRecordKindError extends Error {
  constructor(id: unknown) {
    super(`cannot determine record kind: id ${JSON.stringify(id)} does not start with REQ-, DEC-, or TASK-`);
    this.name = 'UnknownRecordKindError';
  }
}

/**
 * Thrown (as a Result error) when `contentHash` doesn't match the body it's
 * supposed to be hashing — Important 4, review-2026-09-21.md: the field was
 * computed and shape-checked (64 hex chars) but never actually recomputed
 * and compared, so a stale or hand-fabricated hash validated cleanly and
 * its drift-detection purpose went unmet.
 */
export class ContentHashMismatchError extends Error {
  constructor(recorded: string, actual: string) {
    super(`contentHash does not match the record's body: recorded ${recorded}, actual ${actual}`);
    this.name = 'ContentHashMismatchError';
  }
}

/**
 * T21: the record's body failed the ASD-STE100-style readability check.
 * Carries every issue found, not just the first, so a caller can report
 * (or fix) them all at once instead of a slow one-at-a-time loop.
 */
export class ReadabilityError extends Error {
  constructor(public readonly issues: ReadabilityIssue[]) {
    super(`readability check failed: ${issues.map((i) => `[${i.rule}] ${i.message}`).join('; ')}`);
    this.name = 'ReadabilityError';
  }
}

export type ValidateResult =
  | { success: true; record: AnyRecord }
  | { success: false; error: Error };

/**
 * Validate already-parsed frontmatter against the schema its `id` implies.
 * When `body` is supplied, also verifies `contentHash` actually matches it
 * (drift detection) — omit `body` for a frontmatter-only check (e.g. at
 * record-creation time, where the hash was just computed from this exact
 * body and checking it again is a no-op).
 */
export function validateRecord(frontmatter: Record<string, unknown>, body?: string): ValidateResult {
  const id = frontmatter.id;
  const schema = typeof id === 'string'
    ? SCHEMA_BY_PREFIX.find(([prefix]) => id.startsWith(prefix))?.[1]
    : undefined;

  if (!schema) {
    return { success: false, error: new UnknownRecordKindError(id) };
  }

  const result = schema.safeParse(frontmatter);
  if (!result.success) return { success: false, error: result.error };

  if (body !== undefined) {
    const actualHash = computeContentHash(body);
    if (frontmatter.contentHash !== actualHash) {
      return { success: false, error: new ContentHashMismatchError(String(frontmatter.contentHash), actualHash) };
    }

    // T21: "summaries and reports" — a record's body is exactly that, and
    // this is the only kind of text validateRecord ever sees. Code and
    // commit messages never reach this function.
    const readability = validateReadability(body, { strict: frontmatter.readabilityStrict === true });
    if (!readability.ok) {
      return { success: false, error: new ReadabilityError(readability.issues) };
    }
  }

  return { success: true, record: result.data as AnyRecord };
}

/** Parse + validate a full record file in one call, including content-hash drift detection. */
export function validateRecordFile(raw: string): ValidateResult {
  const { frontmatter, body, parseError } = parseRecordFile(raw);
  if (parseError) return { success: false, error: parseError };
  return validateRecord(frontmatter, body);
}

/**
 * Serialize a record's frontmatter + body back into file form (T4, the
 * write side of T3's parse-only scope). Callers should pass an
 * already-validated frontmatter object — this does not re-validate.
 */
export function serializeRecordFile(frontmatter: Record<string, unknown>, body: string): string {
  // Same JSON_SCHEMA as parseRecordFile, for symmetry — dump() doesn't have
  // the timestamp-detection issue on the way out (it's already dumping a
  // string), but using the same schema on both ends keeps round-tripping
  // predictable rather than relying on the two calls happening to agree.
  const yamlBlock = stringifyYaml(frontmatter, { lineWidth: -1, schema: JSON_SCHEMA }).trimEnd();
  const trimmedBody = body.replace(/^\n+/, '');
  return `---\n${yamlBlock}\n---\n\n${trimmedBody}`;
}
