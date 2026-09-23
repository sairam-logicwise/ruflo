---
id: TASK-002
title: Add a schemaVersion field to BaseRecordShape
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.156Z
updatedAt: 2026-09-23T06:20:04.156Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 2775
  highTokens: 4163
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 3288
  outputTokens: 181
  costUsd: 0.012579
contentHash: 4baa12b99b481ec187b625e9f0ed701592c0500534c1fa1b8f4876d0092853c3
provenance: agent-inferred
---

Pilot task for T8 calibration (feature, small).

BaseRecordShape has no schemaVersion field. With `.strict()` schemas, a record written by a newer writer with an extra field would hard-fail an older reader with no diagnosis of why. Propose adding a `schemaVersion: z.number().int().positive().default(1)` field (or similar) to BaseRecordShape, and note what serializeRecordFile/parseRecordFile would need to do differently, if anything.

## Model response

BaseRecordShape has no schemaVersion field today. A .strict() schema hard-fails an older reader on any new field a newer writer adds. It raises a generic "unrecognized key" error, not a diagnosable "needs a newer tool version" message. Add:

```ts
schemaVersion: z.number().int().positive().default(1),
```

to BaseRecordShape. parseRecordFile and serializeRecordFile need no change. An added defaulted field round-trips the same way readabilityStrict already does. This surfaces one real follow-up. records.ts's new commands build the frontmatter object literal by hand. They pass that literal, not validateRecord's default-filled result.data, to serializeRecordFile. So a newly-added defaulted field would validate fine but never reach disk. Fix those call sites to serialize the validated result, or set schemaVersion: 1 explicitly themselves.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

