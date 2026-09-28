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
contentHash: 35ab6ec16fb95e3f25935a51ac93c36d91dee5f454d8a4e77210a737d6bc5941
provenance: agent-inferred
---

Roll the per-task comparison up into one aggregate figure: the hit rate, how often the actual fell inside its own quoted range. Report the real sample size alongside the hit rate. A reader needs that context to read the rate honestly.
