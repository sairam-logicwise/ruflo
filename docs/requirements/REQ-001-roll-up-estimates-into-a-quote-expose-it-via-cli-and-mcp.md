---
id: REQ-001
title: Roll up estimates into a quote, expose it via CLI and MCP
status: accepted
createdAt: 2026-09-23T07:16:21.228Z
updatedAt: 2026-09-23T07:16:21.228Z
citations: []
contentHash: b5f6931ca382940f337310008b696418dedf872dd94e202dc24c3a83c0307b16
provenance: human
supersedes: []
---

Requirement 2's deliverable to stakeholders. Given a requirement's decomposed tasks (T6), roll up each task's estimator range (T10) into one requirement-level quote. A token and cost range, a confidence level, and the per-task breakdown. Ship this as both `ruflo quote <requirement-id>` (CLI) and an MCP tool. Every AI tool target then calls the same primitive and gets the same answer. Quoting a whole backlog should roll up further, across requirements. The output must name its own assumptions explicitly: retry multiplier, corpus size, neighbour count used. A quote nobody can interrogate is a quote nobody will trust.
