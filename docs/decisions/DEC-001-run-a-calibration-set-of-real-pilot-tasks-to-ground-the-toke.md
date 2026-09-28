---
id: DEC-001
title: Run a calibration set of real pilot tasks to ground the token/cost estimator
status: accepted
createdAt: 2026-09-22T11:35:56.046Z
updatedAt: 2026-09-22T11:35:56.046Z
citations: []
contentHash: 2ed4b015d1cb23945bb7fdbc6cd482c498eab4b3858ee7fd9fcf606a0e3d1e2a
provenance: human
supersedes: []
related: []
---

T8 (agentic SDLC plan) needs 15-20 real pilot tasks. Each task runs as one call through callAnthropicMessages. Agent_execute and T6's decompose command use the same call. This CLI has no multi-turn tool loop today. So one completion call is the real unit of cost this system predicts in production.

Each pilot task records its real inputTokens, outputTokens, and costUsd. These values go into a task record's actuals field. Each task cites this decision. Together they form the calibration corpus. T10's nearest-neighbour estimator will use this corpus.

The budget is 30 US dollars for the whole set. The user approved this budget on 2026-09-22. This revises the plan's original 50-dollar ceiling down.

The pilot task set spans different work types: bug-fix, feature, refactor, docs, test-writing, performance, and config. It spans three sizes: small, medium, and large. The system routes each task to haiku, sonnet, or opus by size. This spread avoids favoring any single work type.

This session has no LLM provider credentials. ANTHROPIC_API_KEY, OPENROUTER_API_KEY, and OLLAMA_API_KEY are all unset. So the pilot run has not executed yet. The script run-calibration-pilot.mjs implements the full pipeline. It builds the task list, dispatches each call, tracks cost with a hard budget stop, and writes each task record. Tests verify this pipeline end to end through --dry-run and a mocked LLM call, at zero cost. The pipeline is ready to run for real once credentials exist.
