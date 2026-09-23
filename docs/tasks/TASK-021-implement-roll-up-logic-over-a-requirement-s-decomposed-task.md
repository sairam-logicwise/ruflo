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
contentHash: 2a0693f9d2bd3deb671dc090a7f2be8e761a07da2280f45ac607ae14fbca3267
provenance: agent-inferred
---

Given a requirement id, load every task record citing it. Run T10's predictTokens on each. Combine the individual ranges into one requirement-level range: sum lowTokens and highTokens, and combine confidence honestly, never averaging away a genuinely low individual confidence. Name any task with no estimator prediction available explicitly in the output, rather than silently dropping it from the sum.
