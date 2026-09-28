---
id: TASK-032
title: Give isLegalTransition a real caller (review Important 3)
status: done
priority: p2
createdAt: 2026-09-24T11:15:53.604Z
updatedAt: 2026-09-24T11:15:53.604Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 1033
  highTokens: 1549
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 962
  outputTokens: 329
  costUsd: 0.007821
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
provenance: agent-inferred
contentHash: 78bc30b747d1e57565e15b12b838209de980364f947d98d2d98ee2c45121f418
---

Pilot task for T8 calibration (refactor, medium).

review-2026-09-23.md Important 3: isLegalTransition (state-machine.ts:189) has zero production callers. Confirm this against the real code. Propose either a real caller or removal.

## Model response

isLegalTransition (state-machine.ts:189) has zero production callers. I grepped every non-test file across docops and cli to confirm it. The docops index re-exports it. Nothing in the CLI or docops itself ever calls it. attemptTransition already encodes the same edge logic through its own FORWARD map and PRECONDITIONS. The two never diverge in normal use.

The real value sits elsewhere. applyTaskTransition (records-io.ts) merges a TransitionResult onto raw frontmatter. It checks nothing about whether transition.to is even a legal edge from the CURRENT status on disk. A caller bug could pass a transition computed against an old status — a stale frontmatter read racing a concurrent write, for example.

```ts
export function applyTaskTransition(
  frontmatter: Record<string, unknown>,
  transition: TransitionResult,
): Record<string, unknown> {
  const currentStatus = frontmatter.status as TaskState;
  const targetStatus = transition.ok ? transition.to : 'blocked';
  if (!isLegalTransition(currentStatus, targetStatus)) {
    throw new Error(`illegal transition ${currentStatus} -> ${targetStatus} — refusing to write`);
  }
  // ...unchanged
```

This gives the function a real caller. It catches a class of bug the current code cannot defend against at all.

---
_Actuals note: this session's own model did this task directly. It ran multiple real tool calls (file reads, greps) against the real repository. It did not answer in one shot.

`inputTokens`/`outputTokens` come from a local tokenizer count over the full transcript of that work. Every real tool result read counts as input. Every real tool call issued, plus the final written response, counts as output. This is not just one prompt/response pair.

That count is approximate. It is not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price — the nearest entry in model-prices.ts to this session's real model. This labels the record by the model that actually did the work._

