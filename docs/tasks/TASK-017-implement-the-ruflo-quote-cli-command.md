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
contentHash: ff94b61c9aa1b42c01c24c6152b85b3960519a2607256a6ba57fcb6926aff808
provenance: agent-inferred
---

Wire the roll-up logic into a real ruflo record quote <requirement-id> command (or ruflo quote, matching this repo's existing command-naming conventions). Print the range, confidence, and a per-task breakdown. Refuse cleanly with a clear message when the requirement has no decomposed tasks yet.
