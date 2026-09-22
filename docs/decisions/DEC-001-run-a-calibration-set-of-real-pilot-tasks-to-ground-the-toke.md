---
id: DEC-001
title: Run a calibration set of real pilot tasks to ground the token/cost estimator
status: draft
createdAt: 2026-09-22T11:35:56.046Z
updatedAt: 2026-09-22T11:35:56.046Z
citations: []
contentHash: 9a09331edf0f0f0fde2fa85065423042cd90d22e92bb0bb834d6fe951c45c2e4
provenance: human
supersedes: []
related: []
---

T8 (agentic SDLC plan, tasks/plan.md) needs 15-20 real pilot tasks, each
dispatched as a single call through `callAnthropicMessages` (the same
primitive `agent_execute` and T6's decompose command already use — this
CLI has no multi-turn tool-use dispatch path today, so a single completion
call is the actual unit of cost this system will predict against in
production, not a mismatch with reality).

Each pilot task's real `{inputTokens, outputTokens, costUsd}` is recorded
into a task record's `actuals` field, citing this decision. Together they
become the calibration corpus T10's nearest-neighbour estimator draws on.

Budget: 30 US dollars for the whole set (user-approved 2026-09-22, revising
the plan's original 50-dollar ceiling down). The pilot task set spans
different work types (bug-fix, feature, refactor, docs, test-writing,
performance, config) and sizes (small/medium/large), routed to
haiku/sonnet/opus accordingly, so the corpus isn't skewed toward one kind
of work.

This session has no LLM provider credentials configured
(ANTHROPIC_API_KEY / OPENROUTER_API_KEY / OLLAMA_API_KEY all unset), so the
pilot run itself has not executed yet. `scripts/run-calibration-pilot.mjs`
implements the full pipeline — task list, dispatch, cost tracking with a
hard stop at the budget, and task-record writing — verified end-to-end via
`--dry-run` and a mocked LLM call at $0 cost, ready to run for real the
moment credentials are available.
