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
contentHash: 54a5135ab0e1fde42a130114a0e73ce80b3eb2ac99f2fd55e3be8aa22140de0f
provenance: agent-inferred
---

Run a real task through drafted to done, and separately through drafted to blocked, using the project's own test command. Confirm each resulting record's actuals field holds real, non-fabricated numbers. Cover both paths in one test file.
