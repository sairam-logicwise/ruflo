---
id: TASK-026
title: Record actuals for a task that fails partway through
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
contentHash: 9d35d33c378692c6c50d721298631fa4f57b3b68575d8e283516c4a400d9142a
provenance: agent-inferred
---

A task that stays blocked, a red test or repair exhaustion, still consumed real tokens before failing, especially if record task repair ran. Capture and record whatever was actually spent, not just on a successful done transition. Never leave actuals unset just because the task landed on blocked rather than done.
