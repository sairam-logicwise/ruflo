---
id: TASK-029
title: 'Implement ruflo variance: quoted versus actual per task'
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
contentHash: 92d01b78ee1761582a332fda44b56f41561b0efd1747397a4d02dcbd9f049640
provenance: agent-inferred
---

For every task record carrying both an estimate and actuals, compute and print the quoted range and the real actual total. Say whether the actual fell inside the quoted range. Skip a task missing either field. Report the skipped count too, so the total is never quietly under-reported.
