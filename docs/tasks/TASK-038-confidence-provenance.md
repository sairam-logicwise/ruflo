---
id: TASK-038
title: Fold neighbour provenance (measured vs proxy) into estimator confidence (review Important 13)
status: done
priority: p2
createdAt: 2026-09-24T11:15:53.619Z
updatedAt: 2026-09-24T11:15:53.619Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 753
  highTokens: 1129
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 624
  outputTokens: 317
  costUsd: 0.006627
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
provenance: agent-inferred
contentHash: 85b940ff7a81a16db886c51aa96e789fc1dfe784dc8aa8fa8aed71af8ade17b8
---

Pilot task for T8 calibration (bug-fix, small).

review-2026-09-23.md Important 13: confidence is blind to provenance (predict.ts:92) — it measures corpus density, not validity. Confirm and propose a fix using data already in the pipeline if possible.

## Model response

This is a sharper gap than the review states. EstimatorRow already carries a measured: boolean on every row (corpus.ts:274, set from task.actuals.source === 'measured'). The exact signal needed already flows through the pipeline. computeConfidence (predict.ts:118) just never receives or reads it. Its signature only takes neighborCount, k, avgDistance, and totals. An all-proxy neighbourhood and an all-measured one score identically today, at the same complexity distance.

```ts
function computeConfidence(neighborCount, k, avgDistance, totals, neighbors) {
  const coverage = neighborCount / k;
  const closeness = Math.max(0, 1 - avgDistance);
  const tightness = ...; // unchanged
  const measuredFraction = neighbors.filter((n) => n.row.measured).length / neighbors.length;
  const provenanceTrust = 0.5 + 0.5 * measuredFraction; // never zeroes an all-proxy score — proxy isn't wrong, just less certain
  return Math.max(0, Math.min(1, coverage * closeness * tightness * provenanceTrust));
}
```

This closes the review's own example directly. A thin, proxy-only neighbourhood no longer reads as confident as a well-measured one. It uses data the estimator already has, and currently discards.

---
_Actuals note: this session's own model did this task directly. It ran multiple real tool calls (file reads, greps) against the real repository. It did not answer in one shot.

`inputTokens`/`outputTokens` come from a local tokenizer count over the full transcript of that work. Every real tool result read counts as input. Every real tool call issued, plus the final written response, counts as output. This is not just one prompt/response pair.

That count is approximate. It is not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price — the nearest entry in model-prices.ts to this session's real model. This labels the record by the model that actually did the work._

