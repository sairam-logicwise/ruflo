/**
 * T3 acceptance criterion: "each generating a JSON Schema for editor
 * validation." Also covers review-2026-09-21.md Important 1-3: the raw
 * zodToJsonSchema() output is looser than the Zod contract (any of the
 * three id prefixes accepted everywhere, no citation-count hint at all) —
 * buildRecordJsonSchema()'s post-processing closes that gap as far as
 * JSON Schema draft-07 can express it.
 */

import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildRecordJsonSchema } from '../src/json-schema.js';
import { RequirementSchema } from '../src/schemas/requirement.js';
import { DecisionSchema } from '../src/schemas/decision.js';
import { TaskSchema } from '../src/schemas/task.js';
import type { RecordKind } from '../src/schemas/base.js';

const KINDS: Array<[RecordKind, unknown]> = [
  ['requirement', RequirementSchema],
  ['decision', DecisionSchema],
  ['task', TaskSchema],
];

describe('buildRecordJsonSchema — basic shape', () => {
  it.each(KINDS)('generates a valid draft-07 JSON Schema for %s', (kind, schema) => {
    const jsonSchema = buildRecordJsonSchema(kind, schema);
    expect(jsonSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    const def = jsonSchema.definitions[kind];
    expect(def.properties).toHaveProperty('id');
    expect(def.properties).toHaveProperty('status');
    expect(def.properties).toHaveProperty('provenance');
    expect(def.properties).toHaveProperty('contentHash');
  });
});

describe('buildRecordJsonSchema — id prefix narrowing (Important 2)', () => {
  it.each([
    ['requirement', RequirementSchema, 'REQ-001', 'TASK-001'],
    ['decision', DecisionSchema, 'DEC-001', 'REQ-001'],
    ['task', TaskSchema, 'TASK-001', 'DEC-001'],
  ] as const)('%s only accepts its own id prefix, not another kind\'s', (kind, schema, ownId, wrongKindId) => {
    const jsonSchema = buildRecordJsonSchema(kind, schema);
    const pattern = new RegExp(jsonSchema.definitions[kind].properties.id.pattern!);
    expect(pattern.test(ownId)).toBe(true);
    expect(pattern.test(wrongKindId)).toBe(false);
  });
});

describe('buildRecordJsonSchema — recordId indirection (Important 3)', () => {
  it('citations references the generic recordId definition, not the narrowed id', () => {
    const jsonSchema = buildRecordJsonSchema('task', TaskSchema);
    expect(jsonSchema.definitions.task.properties.citations.items?.$ref).toBe('#/definitions/recordId');
    expect(jsonSchema.definitions.recordId.pattern).toBe('^(REQ|DEC|TASK)-\\d+$');
  });

  it('the recordId definition still accepts any of the three prefixes, unlike the narrowed id', () => {
    const jsonSchema = buildRecordJsonSchema('task', TaskSchema);
    const recordIdPattern = new RegExp(jsonSchema.definitions.recordId.pattern!);
    for (const id of ['REQ-001', 'DEC-001', 'TASK-001']) {
      expect(recordIdPattern.test(id)).toBe(true);
    }
  });
});

describe('buildRecordJsonSchema — citation contract, the expressible half (Important 1)', () => {
  it('task.citations has a contains constraint requiring a REQ or DEC id', () => {
    const jsonSchema = buildRecordJsonSchema('task', TaskSchema);
    expect(jsonSchema.definitions.task.properties.citations.contains).toEqual({
      pattern: '^(REQ|DEC)-\\d+$',
    });
  });

  it('requirement/decision citations have no contains constraint (the rule is task-only)', () => {
    expect(buildRecordJsonSchema('requirement', RequirementSchema).definitions.requirement.properties.citations?.contains).toBeUndefined();
    expect(buildRecordJsonSchema('decision', DecisionSchema).definitions.decision.properties.citations?.contains).toBeUndefined();
  });
});

describe('buildRecordJsonSchema — real ajv validation, not just shape assertions', () => {
  function compile(kind: RecordKind, schema: unknown) {
    const ajv = new Ajv({ allowUnionTypes: true });
    addFormats(ajv);
    return ajv.compile(buildRecordJsonSchema(kind, schema));
  }

  const now = '2026-09-21T00:00:00.000Z';
  const hash = 'a'.repeat(64);

  it('rejects a task citing only another task (contains constraint catches what minItems cannot)', () => {
    const validate = compile('task', TaskSchema);
    const task = {
      id: 'TASK-002', title: 'x', status: 'drafted', priority: 'p1',
      createdAt: now, updatedAt: now, citations: ['TASK-001'], dependsOn: [],
      contentHash: hash, provenance: 'human',
    };
    expect(validate(task)).toBe(false);
    expect(validate.errors?.some((e) => e.keyword === 'contains')).toBe(true);
  });

  it('rejects a requirement record whose id actually belongs to a task', () => {
    const validate = compile('requirement', RequirementSchema);
    const requirement = {
      id: 'TASK-001', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
      citations: [], contentHash: hash, provenance: 'human', supersedes: [],
    };
    expect(validate(requirement)).toBe(false);
  });

  it('accepts a well-formed task citing a requirement', () => {
    const validate = compile('task', TaskSchema);
    const task = {
      id: 'TASK-001', title: 'x', status: 'drafted', priority: 'p1',
      createdAt: now, updatedAt: now, citations: ['REQ-001'], dependsOn: [],
      contentHash: hash, provenance: 'human',
    };
    expect(validate(task)).toBe(true);
  });
});
