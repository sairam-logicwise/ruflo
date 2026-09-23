---
id: TASK-017
title: Implement the ruflo quote CLI command
status: drafted
priority: p2
createdAt: 2026-09-23T07:18:48.592Z
updatedAt: 2026-09-23T07:18:48.592Z
citations:
  - REQ-001
dependsOn: []
doneCriteria:
  testLayers:
    - unit
contentHash: 3a6bad94ac16761a4b1cfa486bb3a166300aa86a86ee4e338cf986fdec48baee
provenance: agent-inferred
---

Wire the roll-up logic into a real ruflo record quote <requirement-id> command (or ruflo quote, matching this repo's existing command-naming conventions). Print the range, confidence, and a per-task breakdown. Refuse cleanly with a clear message when the requirement has no decomposed tasks yet.
