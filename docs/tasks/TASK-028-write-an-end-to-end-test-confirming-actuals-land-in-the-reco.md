---
id: TASK-028
title: Write an end-to-end test confirming actuals land in the record for a real task run
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
    - e2e
contentHash: b68e9b3193401f59da6b57688e5c45e350baaffe0cba912789ef10f45245bc3e
provenance: agent-inferred
---

Run a real task through drafted to done, and separately through drafted to blocked, using the project's own test command. Confirm each resulting record's actuals field holds real, non-fabricated numbers. Cover both paths in one test file.
