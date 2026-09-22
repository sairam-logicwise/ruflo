/**
 * task.ts — the "what work" record (T3) and the citation contract itself.
 * Adapted from DocOps's Task type (../../vendor/schema/types.go); the
 * `requires`-must-be-non-empty-and-not-only-other-tasks rule is DocOps's
 * ADR-0004 alignment rule, carried over as this repo's citation contract
 * (plan.md Task 3 acceptance criterion: "a task must cite at least one
 * requirement or decision").
 *
 * `estimate`/`actuals`/`doneCriteria` are new — DocOps has no equivalent.
 * Their shapes are placeholders each future task will grow into, not
 * finished designs:
 *   - `estimate`: shape matches T10's stated return contract (low/high/
 *     confidence — AD-6 never a point estimate).
 *   - `actuals`: shape matches T13's "capture actuals into the task record".
 *   - `doneCriteria`: minimal stub; T18 formalizes per-task test-layer bars.
 *
 * @module schemas/task
 */

import { z } from 'zod';
import { BaseRecordShape, RecordIdSchema } from './base.js';

/**
 * T15's six-state lifecycle (agentic SDLC plan) — the object the gate
 * (T16) enforces against. Legal transitions and their preconditions live
 * in state-machine.ts, not here; this enum is just the value space.
 * Replaces an earlier, coarser backlog/active/blocked/done placeholder —
 * no real task records existed yet when this changed, so there was
 * nothing to migrate.
 */
export const TaskStatusSchema = z.enum(['drafted', 'specified', 'implementing', 'verifying', 'done', 'blocked']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(['p0', 'p1', 'p2']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

/** AD-6: every quote is a range with a confidence level, never a point estimate. */
export const EstimateSchema = z
  .object({
    lowTokens: z.number().nonnegative(),
    highTokens: z.number().nonnegative(),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .refine((e) => e.highTokens >= e.lowTokens, {
    message: 'highTokens must be >= lowTokens',
    path: ['highTokens'],
  });
export type Estimate = z.infer<typeof EstimateSchema>;

/** T13: actual token/cost consumption, captured when the task completes. */
export const ActualsSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .strict();
export type Actuals = z.infer<typeof ActualsSchema>;

/** T18 formalized this: which test layers apply and an optional coverage bar, declared per task. */
export const DoneCriteriaSchema = z
  .object({
    testLayers: z.array(z.enum(['unit', 'integration', 'e2e', 'automation'])).default([]),
    coverageThreshold: z.number().min(0).max(100).optional(),
  })
  .strict();
export type DoneCriteria = z.infer<typeof DoneCriteriaSchema>;

/**
 * T19: persists a `blocked` transition verdict (state-machine.ts's own
 * `BlockedInfo` shape) onto the record itself — without this, `blocked`
 * would be a dead end nobody could diagnose without external logs.
 * `fromState` excludes `done`/`blocked` themselves, matching
 * `ResumableState` in state-machine.ts (not imported directly — docops's
 * schemas stay free of state-machine.ts's own runtime logic).
 */
export const BlockedSchema = z
  .object({
    reason: z.string().min(1),
    unblockCondition: z.string().min(1),
    fromState: z.enum(['drafted', 'specified', 'implementing', 'verifying']),
  })
  .strict();
export type Blocked = z.infer<typeof BlockedSchema>;

/**
 * The plain object shape, exported separately from the `.strict().refine()`
 * below it — review-2026-09-21.md's Suggestions flagged that the combined
 * form produces a ZodEffects that can't be `.extend()`ed, which T8/T13/T18
 * (and now T19, adding `blocked` above) would each hit by having to
 * hand-edit this file instead of composing on it. Fixed here, now that a
 * fourth task actually ran into the friction, not preemptively guessed at.
 */
export const TaskObjectSchema = z
  .object({
    ...BaseRecordShape,
    id: RecordIdSchema.refine((id) => id.startsWith('TASK-'), {
      message: 'a task id must start with TASK-',
    }),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    dependsOn: z.array(RecordIdSchema).default([]),
    estimate: EstimateSchema.optional(),
    actuals: ActualsSchema.optional(),
    doneCriteria: DoneCriteriaSchema.optional(),
    blocked: BlockedSchema.optional(),
    // Override the base's optional/empty-allowed citations with the
    // citation contract: non-empty, and not satisfied by other tasks alone.
    citations: z
      .array(RecordIdSchema)
      .min(1, 'must cite at least one requirement or decision'),
  })
  .strict();

export const TaskSchema = TaskObjectSchema.refine(
  (t) => t.citations.some((id) => id.startsWith('REQ-') || id.startsWith('DEC-')),
  {
    message: 'must cite at least one REQ or DEC, not only other tasks',
    path: ['citations'],
  },
);

export type Task = z.infer<typeof TaskSchema>;
