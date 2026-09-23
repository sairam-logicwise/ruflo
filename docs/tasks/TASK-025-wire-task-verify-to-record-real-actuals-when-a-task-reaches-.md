---
id: TASK-025
title: Wire task verify to record real actuals when a task reaches done
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
contentHash: 6605b9468de73cf325a774e25c1806f7542f65b1b4dd79c23128b9a9c995b48c
provenance: agent-inferred
---

record task verify already runs the project's real test command. Capture real token and cost consumption when the resulting transition is verifying to done. Source it from the router trajectory log, filtered to that task's own work, or from a captured budget receipt. Write it into the record's actuals field alongside the status update.
