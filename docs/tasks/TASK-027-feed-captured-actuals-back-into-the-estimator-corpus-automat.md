---
id: TASK-027
title: Feed captured actuals back into the estimator corpus automatically
status: drafted
priority: p2
createdAt: 2026-09-23T07:20:04.687Z
updatedAt: 2026-09-23T07:20:04.687Z
citations:
  - REQ-002
dependsOn: []
doneCriteria:
  testLayers:
    - unit
contentHash: 65684cc50f8ee511050d834bd29d47b9c479dc3387d9a666702823e7a38cf6c2
provenance: agent-inferred
---

T10's loadCalibrationRows already scans every docs/tasks/ record with actuals. So a task with real actuals already feeds the corpus on the next read. Confirm this is genuinely automatic, with no separate manual step. Add a regression test proving a newly-captured task shows up without any extra action.
