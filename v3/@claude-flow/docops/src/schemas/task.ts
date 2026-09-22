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

export const TaskStatusSchema = z.enum(['backlog', 'active', 'blocked', 'done']);
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

/** T18 will extend this; for now, just which layers apply and an optional bar. */
export const DoneCriteriaSchema = z
  .object({
    testLayers: z.array(z.enum(['unit', 'integration', 'e2e', 'automation'])).default([]),
    coverageThreshold: z.number().min(0).max(100).optional(),
  })
  .strict();
export type DoneCriteria = z.infer<typeof DoneCriteriaSchema>;

export const TaskSchema = z
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
    // Override the base's optional/empty-allowed citations with the
    // citation contract: non-empty, and not satisfied by other tasks alone.
    citations: z
      .array(RecordIdSchema)
      .min(1, 'must cite at least one requirement or decision'),
  })
  .strict()
  .refine(
    (t) => t.citations.some((id) => id.startsWith('REQ-') || id.startsWith('DEC-')),
    {
      message: 'must cite at least one REQ or DEC, not only other tasks',
      path: ['citations'],
    },
  );

export type Task = z.infer<typeof TaskSchema>;
