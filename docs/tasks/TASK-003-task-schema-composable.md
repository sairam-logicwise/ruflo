---
id: TASK-003
title: Make TaskSchema composable (export the object shape separately from its .strict().refine())
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.159Z
updatedAt: 2026-09-23T06:20:04.159Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 1254
  highTokens: 1882
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 1469
  outputTokens: 99
  costUsd: 0.005892
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: 526c21b39b1c9c9504dfcc813bc1ef9709e5971dce1307efbea5e8241f266164
provenance: agent-inferred
---

Pilot task for T8 calibration (refactor, medium).

TaskSchema chains z.object({...}).strict().refine(...), which produces a ZodEffects. .extend() does not work on a ZodEffects. Future tasks, adding fields for done-criteria or actuals detail, will have to hand-edit this file instead of composing on top of it. Propose exporting the plain object schema, before .strict()/.refine(), under a separate name. Apply .strict().refine() last, to build the schema validation actually uses. Show the concrete diff.

## Model response

T19 already fixed this (review-2026-09-21.md's own Suggestion). TaskObjectSchema now exports separately as the plain z.object({...}).strict() shape. TaskSchema layers .refine(...) on top of TaskObjectSchema. This lets a future field addition .extend() TaskObjectSchema directly. T19's own blocked field was the fourth one to hit this friction, so the fix landed. This needs no further action — a clean "already handled" verdict.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

