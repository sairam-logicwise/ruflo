/**
 * json-schema.ts — build the JSON Schema for a record kind, post-processed
 * to match the Zod contract more closely than a bare zodToJsonSchema() call
 * can (review-2026-09-21.md, Important 1-3):
 *
 *   - Important 2: the record's own `id` is narrowed to its kind-specific
 *     prefix. `zodToJsonSchema` can't see through the `.refine()` that
 *     narrows it in the Zod schema, so the raw output accepts e.g.
 *     `id: "REQ-001"` inside a task record.
 *   - Important 3: citations/dependsOn/supersedes/related reference a
 *     standalone `recordId` definition (any prefix) instead of `$ref`-ing
 *     the record's own (now kind-narrowed) `id` definition — otherwise
 *     narrowing `id` above would silently make every id-reference field
 *     kind-specific too, e.g. citations accepting only other tasks.
 *   - Important 1: task's `citations` gets a `contains` constraint
 *     requiring at least one REQ or DEC id. This is the one part of the
 *     citation contract JSON Schema draft-07 can express (via `contains`);
 *     the full rule ("non-empty AND not only TP") still only lives in the
 *     Zod `.refine()` — editor autocomplete gets closer, not identical,
 *     to the real contract.
 *
 * @module json-schema
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { RecordKind } from './schemas/base.js';

const KIND_ID_PATTERN: Record<RecordKind, string> = {
  requirement: '^REQ-\\d+$',
  decision: '^DEC-\\d+$',
  task: '^TASK-\\d+$',
};

const ANY_RECORD_ID_PATTERN = '^(REQ|DEC|TASK)-\\d+$';
const ID_REFERENCE_FIELDS = ['citations', 'dependsOn', 'supersedes', 'related'];

interface JsonSchemaProperty {
  pattern?: string;
  contains?: Record<string, unknown>;
  items?: { $ref?: string };
  [key: string]: unknown;
}

interface JsonSchemaObjectDefinition {
  properties: Record<string, JsonSchemaProperty>;
  [key: string]: unknown;
}

/** A definitions-map entry is either a record kind's object schema, or a plain scalar schema like `recordId`. */
type JsonSchemaDefinition = JsonSchemaObjectDefinition | { type: string; pattern?: string; [key: string]: unknown };

interface RootJsonSchema {
  definitions: Record<string, JsonSchemaDefinition>;
  [key: string]: unknown;
}

export function buildRecordJsonSchema(kind: RecordKind, zodSchema: unknown): RootJsonSchema {
  const jsonSchema = zodToJsonSchema(zodSchema as never, { name: kind, target: 'jsonSchema7' }) as RootJsonSchema;
  const def = jsonSchema.definitions[kind] as JsonSchemaObjectDefinition;

  // Standalone, reusable "any record id" definition — used by every
  // id-reference field so narrowing this record's own `id` below doesn't
  // narrow them too.
  jsonSchema.definitions.recordId = { type: 'string', pattern: ANY_RECORD_ID_PATTERN };

  def.properties.id.pattern = KIND_ID_PATTERN[kind];

  for (const field of ID_REFERENCE_FIELDS) {
    const prop = def.properties[field];
    if (prop?.items?.$ref) {
      prop.items = { $ref: '#/definitions/recordId' };
    }
  }

  if (kind === 'task' && def.properties.citations) {
    def.properties.citations.contains = { pattern: '^(REQ|DEC)-\\d+$' };
  }

  return jsonSchema;
}
