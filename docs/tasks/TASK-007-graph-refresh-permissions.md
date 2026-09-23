---
id: TASK-007
title: Add a permissions block to graph-refresh.yml
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.167Z
updatedAt: 2026-09-23T06:20:04.167Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 1079
  highTokens: 1619
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 1251
  outputTokens: 98
  costUsd: 0.005223
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: 8736c3985fcbe8db4fdec345ed488c20e15c46b60e7a8921cd29716b37f7f59e
provenance: agent-inferred
---

Pilot task for T8 calibration (config, small).

This workflow has no top-level "permissions:" block. So it inherits the repository's default token permissions, wider than this workflow (checkout plus cache read/write) actually needs. Propose a minimal "permissions: contents: read" block, plus whatever the cache action genuinely requires. Show exactly where it goes in the YAML.

## Model response

Confirmed: no top-level permissions block exists. The workflow inherits the repo's default token scope. This job only checks out code and uses actions/cache for restore and save. Neither step needs write access to repo contents. Cache API auth stays separate from the token's contents scope. Add a minimal block, as a top-level key next to name/on/jobs:

```yaml
permissions:
  contents: read
```

Place it right after the name: graph-refresh line, before on:.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

