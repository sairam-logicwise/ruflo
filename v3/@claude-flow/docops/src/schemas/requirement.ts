/**
 * requirement.ts — the "why" record (T3). Adapted from DocOps's Context
 * type (../../vendor/schema/types.go); renamed to match the plan's own
 * language and given a status field DocOps's Context lacks.
 *
 * @module schemas/requirement
 */

import { z } from 'zod';
import { BaseRecordShape, RecordIdSchema } from './base.js';

export const RequirementStatusSchema = z.enum(['draft', 'accepted', 'superseded']);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const RequirementSchema = z
  .object({
    ...BaseRecordShape,
    id: RecordIdSchema.refine((id) => id.startsWith('REQ-'), {
      message: 'a requirement id must start with REQ-',
    }),
    status: RequirementStatusSchema,
    /** Requirement ids this one supersedes, if any (mirrors DocOps's Context.Supersedes). */
    supersedes: z.array(RecordIdSchema).default([]),
    /** T24: how much real evidence backed an inferred proposal — never set by a human-authored record. Absent, not a fabricated 1.0, when provenance is 'human'. */
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type Requirement = z.infer<typeof RequirementSchema>;
