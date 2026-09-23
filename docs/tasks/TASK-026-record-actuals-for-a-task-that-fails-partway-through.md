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
contentHash: 1eee393f075406703edc6818038e6913781f63d969e3cb683188fc43206d2237
provenance: agent-inferred
---

A task that stays blocked, a red test or repair exhaustion, still consumed real tokens before failing, especially if record task repair ran. Capture and record whatever was actually spent, not just on a successful done transition. Never leave actuals unset just because the task landed on blocked rather than done.
