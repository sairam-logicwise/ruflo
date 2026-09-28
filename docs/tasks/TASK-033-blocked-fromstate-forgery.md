---
id: TASK-033
title: Stop trusting blocked.fromState blindly on resume (review Important 4)
status: done
priority: p1
createdAt: 2026-09-24T11:15:53.611Z
updatedAt: 2026-09-24T11:15:53.611Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 849
  highTokens: 1273
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 707
  outputTokens: 354
  costUsd: 0.007431
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
provenance: agent-inferred
contentHash: 9082a759d7c31ba5a832d9f737136f5a932c4eae2f3b9bfd1a300f019c6adb6d
---

Pilot task for T8 calibration (bug-fix, large).

review-2026-09-23.md Important 4: run.ts:206 trusts blocked.fromState read off disk. Confirm the gap and propose a fix that does not require a new independent history log.

## Model response

run.ts:206 reads task.blocked.fromState straight off disk. It hands that value to attemptTransition as the state to resume into. The schema only checks that fromState is one of the four ResumableState values. It never checks that fromState is the CORRECT one for this task's real history.

Important 5 raises the bar here: a forger must now also recompute the whole-frontmatter contentHash. But a forger who does that can still claim fromState: 'implementing' on a task really blocked back at 'drafted'. They land on whichever precondition happens to be easier. No independent history log exists to check fromState against. The real fix is defense in depth, not ground truth. Replay every ResumableState strictly before the claimed fromState in the forward chain. Reuse phase-check.ts's own statesToAudit() helper — already built and tested for exactly this — before trusting the resume:

```ts
for (const priorState of statesToAudit(fromState)) {
  const priorCheck = attemptTransition(task, priorState, { citationAcceptance: checkCitationAcceptance(ctx, task) });
  if (!priorCheck.ok) {
    stuck.push({ id: task.id, status: task.status, reason: `claimed fromState "${fromState}" is not earned: ${priorCheck.blocked.reason}` });
    continue;
  }
}
```

A forger who claims an un-earned state fails at that earlier step. This holds even when the claimed step's own precondition also holds.

---
_Actuals note: this session's own model did this task directly. It ran multiple real tool calls (file reads, greps) against the real repository. It did not answer in one shot.

`inputTokens`/`outputTokens` come from a local tokenizer count over the full transcript of that work. Every real tool result read counts as input. Every real tool call issued, plus the final written response, counts as output. This is not just one prompt/response pair.

That count is approximate. It is not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price — the nearest entry in model-prices.ts to this session's real model. This labels the record by the model that actually did the work._

