/**
 * decision.ts — the "how it was decided" record (T3). Adapted from
 * DocOps's ADR type (../../vendor/schema/types.go); renamed from ADR to
 * Decision to match the plan's own language ("a task must cite at least
 * one requirement or decision"). Amendments (DocOps's ADR-0025) are out of
 * scope here — nothing in the plan's eight requirements calls for them.
 *
 * @module schemas/decision
 */

import { z } from 'zod';
import { BaseRecordShape, RecordIdSchema } from './base.js';

export const DecisionStatusSchema = z.enum(['draft', 'accepted', 'superseded']);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionSchema = z
  .object({
    ...BaseRecordShape,
    id: RecordIdSchema.refine((id) => id.startsWith('DEC-'), {
      message: 'a decision id must start with DEC-',
    }),
    status: DecisionStatusSchema,
    /** Decision ids this one supersedes, if any. */
    supersedes: z.array(RecordIdSchema).default([]),
    /** Related record ids, informational only (no validation implication). */
    related: z.array(RecordIdSchema).default([]),
  })
  .strict();

export type Decision = z.infer<typeof DecisionSchema>;
