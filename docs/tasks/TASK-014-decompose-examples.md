---
id: TASK-014
title: Add usage examples to the decompose command
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.196Z
updatedAt: 2026-09-23T06:20:04.196Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 3042
  highTokens: 4562
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 3640
  outputTokens: 162
  costUsd: 0.01335
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: d34d9e14ddb0469b29db60e8fc5cca9d063e4efe0bccb637f3b92c659520b860
provenance: agent-inferred
---

Pilot task for T8 calibration (docs, small).

decomposeCommand has no "examples" field (the Command type supports one — see other commands in this codebase for the convention). Propose 2-3 realistic CommandExample entries covering the dry-run, --yes, and --from-file flows. Show the code change.

## Model response

Adding an examples field to decomposeCommand, based on its real --yes and --from-file flags:

```ts
examples: [
  { command: 'ruflo record req decompose REQ-001', description: 'Dry-run: print proposed tasks as JSON, write nothing' },
  { command: 'ruflo record req decompose REQ-001 --yes', description: 'Call the LLM and write the proposed tasks as real task records' },
  { command: 'ruflo record req decompose REQ-001 --from-file proposals.json --yes', description: 'Skip the LLM call, write a human-reviewed/edited proposals file instead' },
],
```

Place it alongside options in the Command object literal. This matches records.ts's own recordCommand.examples convention.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

