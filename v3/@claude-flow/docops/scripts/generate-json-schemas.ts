/**
 * generate-json-schemas.ts — emit editor-consumable JSON Schema per record
 * kind (T3 acceptance criterion: "each generating a JSON Schema for editor
 * validation"). Mirrors DocOps's jsonschema.go, generated from Zod schemas
 * instead of hand-built.
 *
 * Post-processing (id-prefix narrowing, the recordId indirection, the
 * citations `contains` constraint) lives in ../src/json-schema.ts, not
 * here — this script is just "generate, then write to disk"; the tested
 * logic is the importable function (review-2026-09-21.md, Important 1-3).
 *
 * Run via `npm run generate-schemas`. Output is checked in under
 * ../schemas/ so an editor's YAML/JSON-schema extension can point at a
 * stable path without running this script first.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecordJsonSchema } from '../src/json-schema.js';
import { RequirementSchema } from '../src/schemas/requirement.js';
import { DecisionSchema } from '../src/schemas/decision.js';
import { TaskSchema } from '../src/schemas/task.js';
import type { RecordKind } from '../src/schemas/base.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'schemas');
mkdirSync(outDir, { recursive: true });

const targets: Array<[kind: RecordKind, schema: unknown]> = [
  ['requirement', RequirementSchema],
  ['decision', DecisionSchema],
  ['task', TaskSchema],
];

for (const [kind, schema] of targets) {
  const jsonSchema = buildRecordJsonSchema(kind, schema);
  const outPath = join(outDir, `${kind}.schema.json`);
  writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath}`);
}
