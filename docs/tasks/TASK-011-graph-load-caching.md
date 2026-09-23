---
id: TASK-011
title: Avoid re-parsing the full 48MB graph.json on every separate CLI invocation
status: done
priority: p1
createdAt: 2026-09-23T06:20:04.179Z
updatedAt: 2026-09-23T06:20:04.179Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 2376
  highTokens: 3564
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 2681
  outputTokens: 289
  costUsd: 0.012378
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: 6e4d089210a6460997b926edb25e0adba667d305a4295a8b90c6ab5b1f7e6310
provenance: agent-inferred
---

Pilot task for T8 calibration (performance, large).

loadGraph() caches the parsed graph in-memory per graphPath. That cache only helps within ONE process. Every separate `ruflo record req decompose` or feature-extraction CLI invocation pays the full JSON.parse cost of a real ~48MB graph.json again, from a cold process. Propose a concrete, scoped optimization. One option: a persisted, pre-built index of just the code-node label and source_file pairs grounding actually needs, rebuilt only when the graph changes. Sketch the approach. This is a design proposal, not a full implementation. Explain the tradeoffs against just accepting the cold-start cost.

## Model response

This is a design proposal, not a full implementation, as instructed.

loadGraph()'s in-memory graphCache is a module-level Map. It only survives within one process. Every separate CLI invocation cold-starts and pays the full JSON.parse cost of the real graph.json again.

Proposal: persist a small, pre-built grounding index. Store it at graphify-out/grounding-index.json. Hold just {source_file, tokens} pairs for code nodes — the only fields findFilesLikelyTouched actually reads. Key it by a hash of the real graph.json's mtime and size. A staleness check then catches a stale index automatically, rather than trusting it blindly. loadGraph checks for a fresh index first. It loads that, orders of magnitude smaller, instead of the full graph when one exists.

Tradeoffs: this adds a second artifact to keep in sync. The staleness check handles that, not developer discipline. The first invocation after any graph change still pays full cost once, to rebuild the index. Every subsequent cold invocation pays only the tiny index load — the common case, since many separate short-lived CLI calls run in a row.

I considered a long-lived daemon holding the graph in memory across invocations. It solves the same problem. It needs a new IPC and daemon-lifecycle surface, though. That is a materially bigger architectural change. A derived index file already solves the same problem with less new mechanism.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

