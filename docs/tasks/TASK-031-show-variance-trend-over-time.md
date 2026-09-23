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
contentHash: c51a191e181244336f7c9731bb4b292bb73ee4b6bd29421432a6aa6e4f9b15c8
provenance: agent-inferred
---

Group the per-task hit and miss results by a real time dimension, createdAt or updatedAt. Show whether the hit rate is improving as the calibration set grows. A small early sample should read as exactly that, not as a false trend line.
