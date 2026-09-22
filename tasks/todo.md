# Task List: Tool-Neutral Agentic SDLC

Full detail, acceptance criteria and rationale: [plan.md](./plan.md)
**Status:** T1-T7, T9, T12, T15, T16, T18, T19, T20, T21, T23, T25, T26 implemented (18 of 26); T8's pipeline is built and fully verified but NOT yet run for real (see below). Review #1 ([review-2026-09-21.md](./review-2026-09-21.md)) and Review #2 ([review-2026-09-22.md](./review-2026-09-22.md)) are both **closed — all Criticals, blockers and Important items verified fixed by execution, including the one follow-up** (the B1 regression test couldn't run under vitest's `threads` pool; fixed by dropping `process.chdir()` for a subprocess-based approach, verified passing under the real CI invocation shape). T6 and T9 done 2026-09-22 (peer-session handoff, user approved T6+T9). User approved T8's budget at $30 (revised down from the plan's original $50). **This session has no LLM provider credentials configured** — `scripts/run-calibration-pilot.mjs` is built, unit-tested (12 tests, $0), and dry-run-verified against the real 16-task list, but refuses to actually spend anything without a real `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`/`OLLAMA_API_KEY` in this environment (verified: clean exit-2 refusal). Real per-call pricing math shows the full 16-task list costs under $1 even at absolute worst case — the plan's original $2-3/task assumed something closer to a full multi-turn agentic session, not this CLI's actual single-call dispatch primitive. T6's real-LLM output-quality check has the same credentials blocker. T10/T11 remain blocked on T8 actually running.

Also done 2026-09-22, the four tasks unblocked independent of T8 (user: "let's move to unblocked ones"): **T15** (six-state task lifecycle, `docops/src/state-machine.ts` — a real, necessary schema-enum ripple through `records.ts`/`decompose.ts`/tests, caught a stale-`dist/` bug via live testing), **T18** (doneCriteria inferred at decomposition via T9's extractor, editable via T6's existing dry-run loop), **T21** (ASD-STE100 readability gate wired into `validateRecord` — caught a real `formatValidationError` crash via live testing, and retroactively found+fixed a genuine violation in this repo's own DEC-001), **T23** (`ruflo backfill summarize`, zero-cost, graph-derived — verified against two real areas and found two real, documented limitations in Graphify's own extraction along the way, not bugs in this module).

Then **T19** (test runner + derived status), unblocked once T15+T18 landed: `ruflo record task verify` runs the project's real test command and feeds the real exit code (never parsed stdout text) into T15's `attemptTransition`. **Found a genuine bypass via live testing**: `record task new --status=done` (equals syntax) let a brand-new task be created already "done", skipping verification entirely — fixed by removing the `--status` option from task creation altogether, with a permanent regression test. Also fixed `TaskSchema`'s long-flagged `.strict().refine()` composability problem while touching the file a fourth time for a new field.

Then **T20** (wrap the red-to-green repair loop), unblocked by T19: `ruflo record task repair` wraps the existing `plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs` (headless `claude -p`) rather than rewriting it, pinning each spawn to one internal attempt so the new wrapper owns the outer loop and can compare consecutive rounds — two identical failures in a row stop before a third attempt, and cumulative cost reaching budget stops independently of attempt count. `--confirm` required to spend anything (dry-run plan otherwise), and a claimed repair is re-verified with T19's own trusted runner rather than trusted on tdd-repair.mjs's self-report. Verified for real against the actual compiled CLI and the actual wrapped script at $0 (a test-already-passing pre-flight refusal, never reaching the billed `claude -p` spawn) plus 20 fully-mocked unit tests for every bounding edge case — the genuine live-repair path still needs the same kind of explicit spend authorization T8 needed, not yet given for this pipeline.

Then **T25** (the autonomy loop), unblocked once T19+T20 landed: `ruflo run` repeatedly scans task records and calls T15's `attemptTransition()` directly for `drafted`/`specified` (both real evidence gates — safe), runs T19's verify for `verifying`, and optionally T20's repair (once per task per run, `--repair --confirm`) for a red-blocked task. Deliberately never auto-advances `implementing` — that precondition is an intentional no-op in state-machine.ts ("an agent/human signals readiness"), not a missing-evidence gate, and blindly calling attemptTransition on it the same way as the other states would have silently marked mid-implementation tasks "ready to verify" with zero real work done; it's excluded by construction and always reported as needing a human. No separate loop-state file — every task is read fresh and written at most once per pass, so a kill-and-resume is inherently safe. 10 new tests plus a full real end-to-end run against the compiled CLI (including `--repair --confirm` against the actual `tdd-repair.mjs` script, kept at $0 the same way T20's own smoke test was).

Then **T26** (spend backstop), folded directly into `run.ts` rather than a separate file: a per-invocation `spentUsd` local variable sums every repair's real cost, checked before each repair attempt, and once `--spend-ceiling` (default $50) is reached every further repair-eligible task reports stuck instead of spending more — free transitions are untouched by it. No persistence, so a fresh `ruflo run` never carries a prior invocation's spend forward (proven by a test asserting the repair loop genuinely isn't re-invoked, not just that a number reads zero). Verified for real: `--spend-ceiling 0` against the actual compiled CLI completed in under half a second with no child process spawned at all, and the default ceiling still runs the real $0 `tdd-repair.mjs` pre-flight path from T20's own smoke test.

Then **T16** (phase gate), the deliberately-held one — checked in with the user twice before writing code, exactly as flagged. Investigating first: `AgenticPolicyEngine`'s default mode (which the plan names as needing to change) is a sitewide chokepoint for the ENTIRE CLI/MCP surface (ADR-324), not scoped to this plan — flipping it would enforce every unrelated policy rule across the whole platform. User chose: build the gate as its own always-on check, independent of that engine's mode. Second finding: `authorizeMcpTool` (the plan's literal target) only fires for tools registered in `mcp-client.ts`'s MCP-tool registry, and none of this plan's own commands (`record`/`decompose`/`run`/`backfill`) are registered there — there's no MCP-tool surface for these actions at all today. User chose: put the check directly inside the CLI command functions instead, the one real execution path these actions have. Landed as a new precondition on state-machine.ts's `specified` PRECONDITIONS — a task can't reach `specified` unless every cited REQ/DEC is actually `accepted`, wired through `run.ts` (the one caller). **Found a genuine pre-existing bug via manual verification**: `resumeFromBlocked()` had no caller anywhere in the CLI — a task blocked on ANY reason (missing estimate, now also an unaccepted citation) had no path back to progress even after a human fixed it by hand, directly contradicting AD-4's own "blocked is never terminal" promise. Fixed in the same pass: a blocked-from-non-verifying task is now re-attempted every loop pass, counted as progress only when the verdict actually changes (succeeds, or the reason itself changes) — a stable, unchanged reason stops it from being rewritten every pass, same "repeated failure" signal T20's repair loop already uses. Two acceptance-criteria boxes are honestly left unchecked in plan.md rather than reinterpreted: cross-AI-tool verification (no MCP-tool surface to attempt from yet) and the sitewide policy-mode default (deliberately untouched, per the user's own decision).

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
- [x] **T16** Phase gate in the MCP client authorisation path — *M* — deps: T15
- [ ] **T17** CI required check — *S* — deps: T15, T16 — Sairam enables branch protection same day (D4)

### Checkpoint: Phase 4
- [ ] A mandatory step cannot be skipped from Claude Code, Cursor or Codex
- [ ] An invalid change cannot be merged
- [ ] Denials carry actionable messages
- [ ] Human review

---

## Phase 5: Test-gated done

- [x] **T18** Done criteria on the task record — *S* — deps: T3, T6
- [x] **T19** Test runner and derived status — *M* — deps: T15, T18
- [x] **T20** Wrap the red-to-green repair loop — *M* — deps: T19

### Checkpoint: Phase 5
- [ ] A task cannot reach `Done` with a red suite
- [ ] Repair runs automatically and gives up safely
- [ ] Human review

---

## Phase 6: Plain English

- [x] **T21** ASD-STE100 validator in record validation — *M* — deps: T3

---

## Phase 7: Tool adapters

- [ ] **T22** Cursor and generic MCP adapters — *M* — deps: T16

---

## Phase 8: Backfill

- [x] **T23** Mechanical pass over the existing codebase — *M* — deps: T1 — first area `src/ruvector/` (D3)
- [ ] **T24** Inferred requirement extraction — *M* — deps: T16, T23 — one area at a time (D1)

---

## Phase 9: Autonomy

- [x] **T25** The autonomy loop — *M* — deps: T19, T20
- [x] **T26** Spend backstop — *S* — deps: T25

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
