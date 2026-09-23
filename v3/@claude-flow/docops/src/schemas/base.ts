/**
 * base.ts — fields shared by every record kind (T3, agentic SDLC plan).
 *
 * Adapted from the vendored DocOps schema (../../vendor/schema/types.go) —
 * see ../../ATTRIBUTION.md. Deliberate departures from upstream:
 *   - DocOps's Context type carries no `status`; every kind here does,
 *     because the plan's own Task 3 description requires it uniformly.
 *   - DocOps calls this type "Context" (CTX-); we call it "Requirement"
 *     (REQ-) to match the plan's own language throughout ("a task must
 *     cite at least one requirement or decision").
 *
 * @module schemas/base
 */

import { z } from 'zod';

/** The three record kinds and their id prefixes. */
export const RECORD_PREFIXES = {
  requirement: 'REQ',
  decision: 'DEC',
  task: 'TASK',
} as const;

export type RecordKind = keyof typeof RECORD_PREFIXES;

/** A stable id: `<PREFIX>-<digits>`, e.g. `REQ-001`, `DEC-012`, `TASK-003`. */
export const RecordIdSchema = z
  .string()
  .regex(/^(REQ|DEC|TASK)-\d+$/, 'id must match <REQ|DEC|TASK>-<digits>');

/**
 * Distinguishes a human-authored record from one an agent inferred from
 * existing code/docs (T24's backfill). Load-bearing: without this, a
 * guessed requirement becomes indistinguishable from an authored one and
 * the substrate stops being trustworthy (plan.md Task 3 rationale).
 */
export const ProvenanceSchema = z.enum(['human', 'agent-inferred']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** SHA-256 hex digest of a record's content — see ../content-hash.ts. */
export const ContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'contentHash must be a sha256 hex digest');

/**
 * Fields every record kind carries, per plan.md Task 3: "Every record
 * carries a stable id, status, created and updated dates, citations, a
 * content hash, and a provenance field." `status` and `id` are typed more
 * specifically per kind, so they're declared here as the common shape but
 * re-narrowed in each kind's own schema rather than spread verbatim.
 */
export const BaseRecordShape = {
  id: RecordIdSchema,
  title: z.string().min(1, 'title must not be empty'),
  createdAt: z.string().datetime({ message: 'createdAt must be an ISO-8601 datetime' }),
  updatedAt: z.string().datetime({ message: 'updatedAt must be an ISO-8601 datetime' }),
  /**
   * Ids this record cites. Optional and unconstrained at the base level —
   * TaskSchema overrides this with a non-empty, requirement-or-decision
   * refinement (the plan's citation contract applies to tasks only,
   * mirroring DocOps: "ADRs and CTX do not have to cite anything").
   */
  citations: z.array(RecordIdSchema).default([]),
  contentHash: ContentHashSchema,
  provenance: ProvenanceSchema,
  /**
   * T21: opt-in per record, not a repo-wide switch. Default mode (false)
   * enforces the structural ASD-STE100 rules (sentence length, active
   * voice, one instruction per sentence, hedging words); strict mode adds
   * the controlled-vocabulary check on top, for records meant to leave the
   * team (plan.md Task 21's own scoping).
   */
  readabilityStrict: z.boolean().default(false),
  /**
   * Review #3, Important 14: readability is wired into the write path
   * (run.ts refuses to write an invalid result), so a false positive —
   * the structural checks are heuristics over plain text, not a real
   * parser, and can misfire on legitimate prose — made a record
   * permanently unadvanceable with no way out but rewriting around the
   * heuristic. Explicit, per-record, and visible in the diff that sets
   * it (not a repo-wide switch, same discipline as readabilityStrict
   * above): a human sets this to true to accept a record despite a
   * readability failure they've reviewed and judged a false positive —
   * validateRecord still RUNS the check either way, it just stops
   * treating a failure as fatal. Never set true by anything in this
   * codebase automatically.
   */
  readabilityWaived: z.boolean().default(false),
};
