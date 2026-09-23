---
id: TASK-015
title: Check RequirementSchema and DecisionSchema for the same ZodEffects composability issue as TaskSchema
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.199Z
updatedAt: 2026-09-23T06:20:04.199Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 664
  highTokens: 996
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 745
  outputTokens: 85
  costUsd: 0.00351
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: f6220a692947e930682e14cf1e1b7a7af93a4e33420f36f35d39df96478aa637
provenance: agent-inferred
---

Pilot task for T8 calibration (refactor, small).

TaskSchema chains .strict().refine(), which produces a ZodEffects. .extend() does not work on a ZodEffects. Do RequirementSchema or DecisionSchema share that shape: object().strict() with a trailing .refine()? If so, propose the same fix — export the object shape separately, apply refine last. If not, say so plainly, and explain why they differ. A clean "no bug here" verdict is a valid, useful answer.

## Model response

I checked both schemas. Neither has the issue. RequirementSchema and DecisionSchema are each a plain z.object({...}).strict(), with no trailing .refine() at all. Only TaskSchema had one: the citation-contract check. That refine is what produced the un-extendable ZodEffects in the first place. This is a clean "no bug here" verdict. Both schemas already compose directly, as-is.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

