---
id: TASK-031
title: Show variance trend over time
status: drafted
priority: p2
createdAt: 2026-09-23T07:20:05.081Z
updatedAt: 2026-09-23T07:20:05.081Z
citations:
  - REQ-003
dependsOn: []
doneCriteria:
  testLayers:
    - unit
contentHash: e94c535dabe6ce510bd08c90e2ee00d2cf401081dff18e0bcec16547642db87d
provenance: agent-inferred
---

Group the per-task hit and miss results by a real time dimension, createdAt or updatedAt. Show whether the hit rate is improving as the calibration set grows. A small early sample should read as exactly that, not as a false trend line.
