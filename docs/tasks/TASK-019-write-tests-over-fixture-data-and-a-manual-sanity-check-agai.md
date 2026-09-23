---
id: TASK-019
title: Write tests over fixture data, and a manual sanity check against the real calibration set
status: drafted
priority: p2
createdAt: 2026-09-23T07:18:49.518Z
updatedAt: 2026-09-23T07:18:49.518Z
citations:
  - REQ-003
dependsOn: []
doneCriteria:
  testLayers:
    - unit
contentHash: 9291f7e97a389339d92e21382bcd570751389fd2621a9b7fe746c820b8810d9a
provenance: agent-inferred
---

Unit-test the hit-rate and trend computation against fixture task records with known estimate/actual pairs. Then run the real command against this repo's own calibration set and confirm the reported hit rate matches T10's own hold-out result by hand.
