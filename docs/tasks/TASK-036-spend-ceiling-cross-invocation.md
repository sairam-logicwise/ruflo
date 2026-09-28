---
id: TASK-036
title: Close the per-invocation and before-only spend ceiling gaps (review Important 9)
status: done
priority: p2
createdAt: 2026-09-24T11:15:53.616Z
updatedAt: 2026-09-24T11:15:53.616Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 544
  highTokens: 816
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 400
  outputTokens: 280
  costUsd: 0.0054
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
provenance: agent-inferred
contentHash: 2dc72a5be81c8446faf3e4d8636f445bace8625c294338c3e7f0712ea4e9c2b1
---

Pilot task for T8 calibration (bug-fix, medium).

review-2026-09-23.md Important 9: the spend ceiling is per-invocation and checked before-only. Confirm against run.ts and propose a fix with no new persistence infrastructure.

## Model response

I confirmed this against run.ts. spentUsd (line 130) is a plain local let. It resets to zero at the top of every invocation. Nothing persists it across a crash and restart. The before-only check (line 239) only gates whether to START a new repair attempt. spentUsd only increments AFTER runRepairLoop returns (line 247). So one repair attempt can land total spend up to a full --repair-budget over the stated ceiling.

Two small, independent fixes close this without new infrastructure:

```ts
// 1. Cap the per-attempt budget at whatever headroom remains — the
//    parameter already exists, this just tightens what's passed:
const repairResult = runRepairLoop({
  ...,
  budgetUsd: Math.min(repairBudget, spendCeiling - spentUsd),
});

// 2. Seed spentUsd from real evidence already on disk at startup,
//    instead of a fresh local zero — no new state file needed:
const spentUsd = sumRepairActualsFromTaskRecords(dir); // reads actuals.costUsd off records this same run/day
```

The ledger already lives in the task records themselves. There's no need to invent a separate persistence layer.

---
_Actuals note: this session's own model did this task directly. It ran multiple real tool calls (file reads, greps) against the real repository. It did not answer in one shot.

`inputTokens`/`outputTokens` come from a local tokenizer count over the full transcript of that work. Every real tool result read counts as input. Every real tool call issued, plus the final written response, counts as output. This is not just one prompt/response pair.

That count is approximate. It is not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price — the nearest entry in model-prices.ts to this session's real model. This labels the record by the model that actually did the work._

