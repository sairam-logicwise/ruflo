---
id: DEC-002
title: Predict from nearest historical neighbours, not a trained regression model
status: draft
createdAt: 2026-09-23T08:21:28.019Z
updatedAt: 2026-09-23T08:21:28.019Z
citations: []
contentHash: aacc491622187d215a17382df0a0e30fbce803c4d1c17b06fd064f714d3f3af7
provenance: agent-inferred
confidence: 0.75
supersedes: []
related: []
---

predict.ts finds the k nearest rows in the training corpus. It measures distance by complexity score. It reports their token range. It does not fit a regression model to predict a value directly. The real dependency list explains why a regression model lost out. This area's training data comes from two thin, growing sources. One source is the router's own trajectory log. The other is each task's own recorded actuals. A regression model needs a stable feature set. It also needs enough rows to fit well. Nearest-neighbour degrades gracefully with only a handful of rows. It improves automatically as more real work completes. It needs no retraining step. It has no model file to go stale. corpus.ts's own two loaders are the real evidence for this reading. They feed exactly the two thin sources a neighbour search can use right away. A regression model could not use them the same way.
