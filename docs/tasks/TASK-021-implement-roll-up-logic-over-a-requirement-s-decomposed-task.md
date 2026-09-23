---
id: TASK-021
title: Implement roll-up logic over a requirement's decomposed tasks' estimates
status: drafted
priority: p2
createdAt: 2026-09-23T07:20:04.209Z
updatedAt: 2026-09-23T07:20:04.209Z
citations:
  - REQ-001
dependsOn: []
doneCriteria:
  testLayers:
    - unit
contentHash: 63370529c6d326bf4ec5474b732bad3b132e118fd7b21b8f4b839903683f71c2
provenance: agent-inferred
---

Given a requirement id, load every task record citing it. Run T10's predictTokens on each. Combine the individual ranges into one requirement-level range: sum lowTokens and highTokens, and combine confidence honestly, never averaging away a genuinely low individual confidence. Name any task with no estimator prediction available explicitly in the output, rather than silently dropping it from the sum.
