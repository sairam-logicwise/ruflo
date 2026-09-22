# Handover: Tool-Neutral Agentic SDLC

**For:** a session or engineer starting cold on this repo
**Written:** 2026-09-18
**State:** planning complete and approved. No implementation code written yet.

Read this file, then [todo.md](./todo.md), then [plan.md](./plan.md) for task detail.

---

## 1. What we are building

An agentic SDLC that **any** AI coding tool can drive — Claude Code, Cursor, Codex, or any MCP client. It turns a requirement into a merged change, and it must satisfy eight requirements:

1. AI-native workflow — one command drives spec to merged change
2. **Token estimation** — quote tokens and dollars for a feature or a whole backlog, before building
3. Agentic SDLC — named agents and skills own each phase, swappable per tool
4. Plain English output — every human-facing artifact passes a readability check
5. Typed project state — requirement, decision and task as validated records with traceable links
6. Mandatory steps — a required step cannot be skipped by any agent in any tool
7. Autonomy — runs unattended to a quality bar, escalates only when blocked
8. Self-QA — writes and runs unit, integration, end-to-end and automation tests

**Requirement 2 is the team's stated first priority.** The plan is sequenced so a quote is demoable at Phase 2, about 2.5 weeks in.

## 2. Repo and pilot

- Base: our fork of ruflo, pinned at **v3.42.3** (`6f0ed7112`). Local `main` is identical to upstream `ruvnet/ruflo` main.
- Root package is **MIT** — avoid GPL dependencies.
- **The pilot is this repo itself.** We build the workflow into the fork and run it on the fork.
- Architecture doc (living, with comment threads): https://claude.ai/code/artifact/2570638b-27be-4883-96e9-857c58553afd

## 3. The one idea everything rests on

**The record is the gate, not the prompt.**

An instruction in `CLAUDE.md`, `.cursorrules` or `AGENTS.md` is advisory in every tool. We researched nine spec-workflow projects; every claimed gate is a string in a prompt file that an agent can ignore, and the strongest only checks that a file exists, not that it was accepted.

So we do not ask the agent to follow a process. We make the next step **unavailable** until its precondition record exists. If `implement` requires an accepted spec record, and the engine will not emit implementation context without one, no tool can skip the spec.

**Enforcement lives in exactly two places that work across tools:**
- `authorizeMcpTool` in the MCP **client** path — `v3/@claude-flow/cli/src/services/policy-runtime.ts:376`, called from `v3/@claude-flow/cli/src/mcp-client.ts:265`
- Git hooks and CI required checks

**Do not** put the gate in `mcp-server.ts:653`. That seam is stdio-only (bypassed by switching transport) and receives only a tool name and session id — not the tool input.

**Accepted limit:** an MCP gate cannot see a tool's built-in file editor. We are not preventing edits. We prevent unspecified work becoming a commit, and unverified commits becoming merges.

## 4. Traps — verified stubs and dead wires

Five parallel audits found that ruflo's mechanisms are often written correctly and **connected to nothing**. Do not credit a feature because a README, CLAUDE.md or an agent name implies it. Open the file.

**Returns canned data — do not build on these:**
- **All 12 background workers** (`v3/@claude-flow/swarm/src/workers/worker-dispatch.ts`). Every executor returns a hardcoded object literal; `processWorkPhase` is a ≤10ms sleep. The file has **no filesystem or process import**, so it cannot read a repo. `testgaps` returns fixed `coverage: {statements: 75}` and a placeholder `src/utils.ts / parseConfig`.
- **Test generation** (`v3/plugins/agentic-qe/src/tools/test-generation/generate-tests.ts`). Builds three stubs from the filename, never reads source, never calls a model, writes nothing.
- `ast-analyzer.ts` is **misnamed** — line-by-line regex, no nesting, no call graph, no cross-file resolution.

**Built correctly, zero callers:**
- `EnforcementGates`, `OfficialHooksBridge`, `GuidanceProvider` — a complete, correct deny pipeline nothing invokes.
- `ContinueGate` — only consumer is its own test.

**Default-off or wrong-by-default:**
- `AgenticPolicyEngine` defaults to `legacy` mode, which **forces `enforcedOutcome: 'allowed'`** regardless of the decision — `v3/@claude-flow/security/src/policy/evaluator.ts:124`. **T16 must change this default or the gate is a no-op.**
- MCP policy enforcer is opt-in behind `RUFLO_MCP_ENFORCE_POLICY=1` and only rate-limits.
- The Claude Code hook handler exits **1** where blocking needs **2**, so `[BLOCKED]` never blocks. `pre-edit` is wired in settings.json to a handler that does not exist.
- Autopilot is never installed by `init`, its check returns exit 0, and **`'failed'` is in `TERMINAL_STATUSES`** — a failed task counts as done. We do not use it.
- `predictedCostUsd` is hardcoded `0` with the comment "bandit doesn't price".
- `claims_check` / `claims_grant` / `claims_revoke` are advertised but **do not exist**.

**Testing maturity signal:** CI carries **121 known-failing test files** on a ratchet (`scripts/ci-test-ratchet.mjs`), coverage thresholds are commented out in `v3/vitest.config.ts`, and the verification pipeline runs `continue-on-error: true`. **Assume inherited code is unproven until you test it.** When something fails in the pilot, suspect inherited breakage before suspecting our workflow.

## 5. What is genuinely good — reuse, do not rewrite

| Component | Path | Why |
|---|---|---|
| Red→green repair | `plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs` | Runs tests, refuses if green, budget-capped headless fixer, gates on exit code |
| Promotion gate pattern | `v3/@claude-flow/cli/src/services/harness-benchmark.ts:124-135` | Six AND-ed terms; best gate pattern in the repo. Retarget at task done-criteria |
| Trajectory log | `v3/@claude-flow/cli/src/ruvector/router-trajectory.ts:94-109` | `{task text, complexity, model, actual tokens, actual cost}` — the estimator's training corpus |
| Complexity extractor | `v3/@claude-flow/cli/src/ruvector/model-router.ts:836` | `analyzeComplexity()`, reuse so estimates and routing agree |
| Coverage parser | `v3/@claude-flow/cli/src/ruvector/coverage-router.ts:445` | Genuinely reads your istanbul/lcov output |
| Receipt subsystem | `v3/@claude-flow/cli/src/services/flywheel-receipt.ts:250,261,474,595` | Canonical JSON, SHA-256 ids, Ed25519 signing, unknown-field rejection |
| Headless executor | `v3/@claude-flow/cli/src/services/headless-worker-executor.ts` | Working budgeted `claude -p` driver |

## 6. Extension points (verified)

- **Add an MCP tool:** new file exporting `MCPTool[]`, then one import + one spread in `v3/@claude-flow/cli/src/mcp-client.ts:133-194`. Raw JSON Schema, not Zod. Smallest example: `v3/@claude-flow/cli/src/mcp-tools/x-federation-join.ts:54-79`. Note `mcp-tools/index.ts` is a *parallel, incomplete* barrel — `mcp-client.ts` is authoritative.
- **Add a CLI command:** new file exporting a `Command` object + default export, then one line in `commandLoaders` at `v3/@claude-flow/cli/src/commands/index.ts:25-106`. Custom framework, not commander. Template: `v3/@claude-flow/cli/src/commands/advisor.ts` (99 lines).
- **Add a tool target:** new generator following `(options) => Promise<string>` in `v3/@claude-flow/codex/src/generators/index.ts`, plus an entry in `initializer.ts:868-889`. **Nothing for Cursor exists** — zero references anywhere.

## 7. Adopt vs build

**Adopt as-is:** [Graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0 + MIT) for code mapping. Already indexed this repo — `graphify-out/` holds 3,667 files, 57,751 nodes, 81,511 edges, built from commit `6f0ed711`, at **zero token cost**. Whole-monorepo single graph, MCP server, tags every edge extracted or inferred with confidence. Refresh with `graphify update .`

**Fork, do not depend:** [DocOps](https://github.com/logicwind/DocOps) (MIT) for the record substrate. Only project with genuinely typed records, generated JSON Schema, and a validator enforcing that every task cites a decision or context. But it is one person's project, one star, untouched since May — vendor it.

**Build ourselves:** the gate, token estimation, plain-English validation, test-gated done, requirement inference, the Cursor adapter, the state machine and autonomy loop. Nobody sells these.

**Design borrowed, code not:** [rtmx](https://github.com/rtmx-ai/rtmx) derives requirement status from linked test results. Copy the model in T19.

## 8. Approved decisions (do not re-litigate)

| # | Decision |
|---|---|
| D1 | Backfill one area at a time, never all 3,667 files at once |
| D2 | No fixed retry limit; a high total spend limit before the first overnight run |
| D3 | First backfill area is `v3/@claude-flow/cli/src/ruvector/` |
| D4 | Sairam enables branch protection, on the day T17 merges |
| D5 | Calibration set budget is $50, about $2-3 per task |

Also settled: quoting ships first (Phase 2); estimator v0 is nearest-neighbour, not regression; every quote is a range with confidence, never a point estimate; failure routes to `Blocked`, never `Done`.

## 9. Where to start

26 tasks in 10 phases, vertically sliced. Three have no dependencies:

- **T12** — fix pricing and tokenizer bugs. *Recommended first.* Two disagreeing price tables, unknown models silently priced at a made-up rate, every token count is `length / 4`, `predictedCostUsd` hardcoded to 0. Every number the quote produces flows through this code.
- **T7** — build the training corpus from the existing trajectory log. Can run parallel to T12.
- **T1** — wire Graphify in as an MCP server with CI refresh.

Commands: `npm test` (vitest), `npm run build` (tsc), both at root and in `v3/@claude-flow/cli`.

## 10. House rules that bite

From `CLAUDE.md`: never save working files to the root folder; `/src`, `/tests`, `/docs`, `/config`, `/scripts`, `/examples`. Keep files under 500 lines. Read a file before editing it. Never commit secrets or `.env`.

Publishing is a separate, explicitly authorised action — three packages in lockstep (`@claude-flow/cli`, `claude-flow`, `ruflo`). Do not publish as part of normal work.
