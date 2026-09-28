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
contentHash: be9ea51230536f1742a9ad01bbead081ea337deed7cf8331217fadf3941e0c1c
provenance: agent-inferred
---

Make the default CLI output readable by someone who is not a developer. Show the range, the confidence level in plain language, and a short explanation of what drives the range: retry multiplier, corpus size. Keep the --json output separate and unaffected, for programmatic callers.
