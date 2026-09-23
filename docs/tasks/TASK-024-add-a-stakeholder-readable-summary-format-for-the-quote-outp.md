---
id: TASK-024
title: Add a stakeholder-readable summary format for the quote output
status: drafted
priority: p2
createdAt: 2026-09-23T07:20:04.209Z
updatedAt: 2026-09-23T07:20:04.209Z
citations:
  - REQ-001
dependsOn: []
doneCriteria:
  testLayers: []
contentHash: 09034b0b360b43df95ffc89b5e5ef50aa048cc9941a3d772afc22bab14fabfbc
provenance: agent-inferred
---

Make the default CLI output readable by someone who is not a developer. Show the range, the confidence level in plain language, and a short explanation of what drives the range: retry multiplier, corpus size. Keep the --json output separate and unaffected, for programmatic callers.
