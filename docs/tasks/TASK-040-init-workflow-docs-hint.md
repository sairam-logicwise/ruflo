---
id: TASK-040
title: Surface `record workflow-docs` in `init`'s own next-steps output (review Important 17)
status: done
priority: p2
createdAt: 2026-09-24T11:15:53.622Z
updatedAt: 2026-09-24T11:15:53.622Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 609
  highTokens: 913
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 490
  outputTokens: 271
  costUsd: 0.005535
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
provenance: agent-inferred
contentHash: 4970d55dd58b777dc6f21d741714fbd62ba69f0e838c442a48526de13facde19
---

Pilot task for T8 calibration (docs, small).

review-2026-09-23.md Important 17: init does not emit the workflow docs (T22). Confirm the claim, check whether this was a deliberate prior decision before proposing a change, and propose the real residual fix.

## Model response

The literal claim is accurate. Grepping init.ts turns up zero references to workflow-docs. But workflow-docs.ts's own header comment shows this was deliberate. The user already confirmed this decision — a standalone command, not a hook into the 1700-line init/CodexInitializer pipeline, to avoid a large, unrelated entanglement. Given that, wiring it directly into init would re-litigate a decision that's already settled.

The real residual gap is narrower. init.ts's own 'Next steps:' output (two separate blocks, lines 474 and 868) never mentions `record workflow-docs` at all. A user running init has no way to discover the command, short of reading source or this review.

```ts
output.writeln('  ruflo record workflow-docs   # write the agentic-SDLC workflow section into CLAUDE.md/AGENTS.md');
```

Adding one line to both blocks closes the real discoverability gap. It does not reopen the architecture decision the header comment already documents.

---
_Actuals note: this session's own model did this task directly. It ran multiple real tool calls (file reads, greps) against the real repository. It did not answer in one shot.

`inputTokens`/`outputTokens` come from a local tokenizer count over the full transcript of that work. Every real tool result read counts as input. Every real tool call issued, plus the final written response, counts as output. This is not just one prompt/response pair.

That count is approximate. It is not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price — the nearest entry in model-prices.ts to this session's real model. This labels the record by the model that actually did the work._

