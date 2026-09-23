---
id: TASK-020
title: Design quote.ts's CLI interface and output shape
status: drafted
priority: p2
createdAt: 2026-09-23T07:20:04.209Z
updatedAt: 2026-09-23T07:20:04.209Z
citations:
  - REQ-001
dependsOn: []
doneCriteria:
  testLayers: []
contentHash: 08e856eb25bcc2acb945aa80d65a22384efc6033b777ea4494d85e9f8005951e
provenance: agent-inferred
---

Decide ruflo quote <requirement-id>'s exact flags and output fields before writing the implementation. Cover the default human-readable output and a --json flag for machine consumption. Name every assumption the output must show: retry multiplier, corpus size, neighbour count. Write this as a short design note or the interface's type definitions, not the full implementation.
