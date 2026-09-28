---
id: TASK-039
title: Log why a task record is excluded from the calibration corpus (review Important 15)
status: done
priority: p2
createdAt: 2026-09-24T11:15:53.620Z
updatedAt: 2026-09-24T11:15:53.620Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 690
  highTokens: 1036
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 514
  outputTokens: 349
  costUsd: 0.006777
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
provenance: agent-inferred
contentHash: 78bfc6a2c67f0f22bddcff23a80a7bccf7a9071e540717be171353aee377e1ba
---

Pilot task for T8 calibration (bug-fix, small).

review-2026-09-23.md Important 15: corpus.ts:260 silently drops records failing readability from the estimator training data, with no log line. Confirm and propose a fix, reusing an existing pattern if one fits.

## Model response

I confirmed this exactly. loadCalibrationRows (corpus.ts:257) calls validateRecord. That call runs the T21 readability check internally, as part of validated.success (frontmatter.ts:170). A record that fails only on readability hits the same `if (!validated.success) continue;` as a genuinely broken record. A parse error, a schema violation, a content-hash mismatch — none of these get distinguished from readability. Nothing logs which one actually happened.

variance.ts, right next to this file, already solves the identical problem. It returns a skipped: {taskId, title, reason}[] array alongside its rows. loadCalibrationRows should return the same shape:

```ts
export function loadCalibrationRows(repoRoot: string, graphPath?: string): { rows: EstimatorRow[]; skipped: Array<{ file: string; reason: string }> } {
  const rows = [];
  const skipped = [];
  for (const file of ...) {
    if (parseError) { skipped.push({ file, reason: `parse error: ${parseError.message}` }); continue; }
    if (!validated.success) { skipped.push({ file, reason: `does not validate: ${validated.error.message}` }); continue; }
    if (!task.actuals) { skipped.push({ file, reason: 'no actuals recorded' }); continue; }
    rows.push(...);
  }
  return { rows, skipped };
}
```

This reuses an already-built, already-tested pattern from the same file family instead of inventing a new one.

---
_Actuals note: this session's own model did this task directly. It ran multiple real tool calls (file reads, greps) against the real repository. It did not answer in one shot.

`inputTokens`/`outputTokens` come from a local tokenizer count over the full transcript of that work. Every real tool result read counts as input. Every real tool call issued, plus the final written response, counts as output. This is not just one prompt/response pair.

That count is approximate. It is not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price — the nearest entry in model-prices.ts to this session's real model. This labels the record by the model that actually did the work._

