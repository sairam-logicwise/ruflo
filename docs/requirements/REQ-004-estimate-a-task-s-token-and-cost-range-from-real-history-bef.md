---
id: REQ-004
title: Estimate a task's token and cost range from real history before work starts
status: draft
createdAt: 2026-09-23T08:21:28.019Z
updatedAt: 2026-09-23T08:21:28.019Z
citations: []
contentHash: 6ddedb332f258d4fb42ecd03e69ad8de1862cf96b8372e614b94434721cca676
provenance: agent-inferred
confidence: 0.85
supersedes: []
---

A planning tool must predict roughly how much a task will cost before anyone starts it. This area's own module names say so directly. Three files exist only to answer that question: predict.ts, corpus.ts, and quote.ts. The corpus.ts module builds a labelled training set from two real sources. It reads the router's own trajectory log. It also reads past tasks' recorded actuals. The predict.ts module turns a new task's complexity score into a token range. It never returns a single number. It always attaches a confidence level. The quote.ts module rolls that range up across a whole requirement. It prices the total against model-prices.ts. The real git history backs this reading. T10 built the estimator first. T11 built quote.ts directly on top of it, in the very next commit. Both import model-router.ts and model-prices.ts. Those are the same pricing and complexity tools the rest of this codebase already trusts for routing decisions.
