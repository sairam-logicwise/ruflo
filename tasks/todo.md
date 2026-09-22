# Task List: Tool-Neutral Agentic SDLC

Full detail, acceptance criteria and rationale: [plan.md](./plan.md)
**Status:** T1-T7, T9, T12 implemented; T8's pipeline is built and fully verified but NOT yet run for real (see below). Review #1 ([review-2026-09-21.md](./review-2026-09-21.md)) and Review #2 ([review-2026-09-22.md](./review-2026-09-22.md)) are both **closed — all Criticals, blockers and Important items verified fixed by execution, including the one follow-up** (the B1 regression test couldn't run under vitest's `threads` pool; fixed by dropping `process.chdir()` for a subprocess-based approach, verified passing under the real CI invocation shape). T6 and T9 done 2026-09-22 (peer-session handoff, user approved T6+T9). User approved T8's budget at $30 (revised down from the plan's original $50). **This session has no LLM provider credentials configured** — `scripts/run-calibration-pilot.mjs` is built, unit-tested (12 tests, $0), and dry-run-verified against the real 16-task list, but refuses to actually spend anything without a real `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`/`OLLAMA_API_KEY` in this environment (verified: clean exit-2 refusal). Real per-call pricing math shows the full 16-task list costs under $1 even at absolute worst case — the plan's original $2-3/task assumed something closer to a full multi-turn agentic session, not this CLI's actual single-call dispatch primitive. T6's real-LLM output-quality check has the same credentials blocker. T10/T11 remain blocked on T8 actually running.

Legend — scope: **S** 1-2 files · **M** 3-5 files

---

## Phase 0: Adopt

- [x] **T1** Wire Graphify in as an MCP server with CI refresh — *S* — deps: none
- [x] **T2** Fork DocOps into the repo (vendor, do not depend) — *M* — deps: none

### Checkpoint: Phase 0
- [ ] `npm test` passes, `npm run build` succeeds — tests pass (45 docops + CLI tests, all green as of 2026-09-22's review fixes); build has **4** `TS6305` errors in `@claude-flow/cli` from an unbuilt `@claude-flow/swarm` sibling, unrelated to T1/T2. `@claude-flow/docops` and `@claude-flow/cli-core` build clean. (Corrected 2026-09-21: the earlier "472 errors" figure was wrong.)
- [ ] Graph queryable from two different AI tools — only verified from this session/tool; no second AI tool (Cursor/Codex) has queried it yet
- [x] Record validation rejects an uncited task — verified repeatedly (T4/T5)
- [ ] Human review

---

## Phase 1: A record exists and validates

- [x] **T3** Define the three record schemas (requirement, decision, task) — *M* — deps: T2
- [x] **T4** Record CLI: create, show, list, validate — *M* — deps: T3
- [x] **T5** Citation contract as a git pre-commit hook — *S* — deps: T3, T4

### Checkpoint: Phase 1
- [x] Requirement and task can be created, linked, listed, validated — verified manually via the real compiled CLI (`ruflo record req/task new|show|list`)
- [x] Invalid records refused at CLI and at commit — verified manually at both layers (CLI refusal message + the installed pre-commit hook)
- [x] Tests pass, build clean — **fixed 2026-09-22**: `cd v3/@claude-flow/docops && npm test` now runs for real (review Important 11 fixed — package-local vitest config added), 45 tests pass. Build still has the same 4-error `@claude-flow/swarm` caveat as Phase 0 (pre-existing, unrelated).
- [ ] Human review

---

## Phase 2: Quote a feature — FIRST DEMO

- [x] **T6** Requirement decomposition agent — *M* — deps: T1, T4 (real-LLM quality pass still pending — see plan.md)
- [x] **T7** Build training corpus from the existing trajectory log — *S* — deps: none
- [ ] **T8** Calibration set: 15-20 labelled pilot tasks — *M* — deps: T4, T7 — budget $30 (D5, revised); pipeline built + verified 2026-09-22, not yet run (no credentials in this session)
- [x] **T9** Feature extractor for a task record — *M* — deps: T1, T3
- [ ] **T10** Estimator v0: nearest neighbour with ranges — *M* — deps: T7, T8, T9
- [ ] **T11** `ruflo quote` command and MCP tool — *M* — deps: T6, T10, T12
- [x] **T12** Fix inherited pricing and token-counting bugs — *M* — deps: none

### Checkpoint: Phase 2 — DEMO
- [ ] Requirement decomposed and quoted end to end
- [ ] Quote is a range with stated confidence and visible assumptions
- [ ] Same quote reachable from at least two AI tools
- [ ] Hold-out hit rate recorded as accuracy baseline
- [ ] Demo to stakeholders, then human review

---

## Phase 3: Close the estimation loop

- [ ] **T13** Capture actuals into the task record — *M* — deps: T10, T11
- [ ] **T14** Variance report — *S* — deps: T13

### Checkpoint: Phase 3
- [ ] Estimate and actual both recorded, variance reportable
- [ ] Corpus grows automatically as work completes
- [ ] Human review

---

## Phase 4: The gate

- [x] **T15** Task state machine with transition preconditions — *M* — deps: T3
- [ ] **T16** Phase gate in the MCP client authorisation path — *M* — deps: T15
- [ ] **T17** CI required check — *S* — deps: T15, T16 — Sairam enables branch protection same day (D4)

### Checkpoint: Phase 4
- [ ] A mandatory step cannot be skipped from Claude Code, Cursor or Codex
- [ ] An invalid change cannot be merged
- [ ] Denials carry actionable messages
- [ ] Human review

---

## Phase 5: Test-gated done

- [x] **T18** Done criteria on the task record — *S* — deps: T3, T6
- [ ] **T19** Test runner and derived status — *M* — deps: T15, T18
- [ ] **T20** Wrap the red-to-green repair loop — *M* — deps: T19

### Checkpoint: Phase 5
- [ ] A task cannot reach `Done` with a red suite
- [ ] Repair runs automatically and gives up safely
- [ ] Human review

---

## Phase 6: Plain English

- [ ] **T21** ASD-STE100 validator in record validation — *M* — deps: T3

---

## Phase 7: Tool adapters

- [ ] **T22** Cursor and generic MCP adapters — *M* — deps: T16

---

## Phase 8: Backfill

- [ ] **T23** Mechanical pass over the existing codebase — *M* — deps: T1 — first area `src/ruvector/` (D3)
- [ ] **T24** Inferred requirement extraction — *M* — deps: T16, T23 — one area at a time (D1)

---

## Phase 9: Autonomy

- [ ] **T25** The autonomy loop — *M* — deps: T19, T20
- [ ] **T26** Spend backstop — *S* — deps: T25

### Checkpoint: Complete
- [ ] All eight requirements demonstrably met
- [ ] Workflow drives a real feature end to end in two different AI tools
- [ ] Quote, variance, gates, QA and autonomy working together
- [ ] Final review

---

## Can run in parallel

- T7 + T12 — no shared files, both unblock Phase 2
- T21 + T22 — independent
- T23 alongside Phase 4

## Must stay sequential

- T2 → T3 → T4 — schema changes ripple everywhere
- T15 → T16 → T17 — gate tiers must share one state machine
- T19 → T20 — repair depends on the runner

---

## Decisions — all approved 2026-09-18

Nothing is blocked. Full reasoning in [plan.md](./plan.md#decisions).

| # | Decision | Affects |
|---|---|---|
| D1 | Backfill one area at a time, never all 3,667 files at once | T23, T24 |
| D2 | No fixed retry limit, but a high total spend limit before the first overnight run | T26 |
| D3 | First backfill area is `v3/@claude-flow/cli/src/ruvector/` | T23 |
| D4 | Sairam turns on branch protection, on the day T17 merges | T17 |
| D5 | Calibration set budget — originally 50 US dollars, revised to 30 (2026-09-22); real per-call cost is far below the original 2-3 dollars/task estimate | T8 |
