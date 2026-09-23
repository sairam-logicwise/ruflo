---
id: TASK-030
title: Aggregate variance and hit rate across all delivered tasks
status: drafted
priority: p2
createdAt: 2026-09-23T07:20:05.081Z
updatedAt: 2026-09-23T07:20:05.081Z
citations:
  - REQ-003
dependsOn: []
doneCriteria:
  testLayers: []
contentHash: 9ce57b59fc214a5fdcc502c6e850b8688ca27ccbd0a404ef6bd23bdb371e6e65
provenance: agent-inferred
---

Roll the per-task comparison up into one aggregate figure: the hit rate, how often the actual fell inside its own quoted range. Report the real sample size alongside the hit rate. A reader needs that context to read the rate honestly.
