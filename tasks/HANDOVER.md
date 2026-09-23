# Handover: Tool-Neutral Agentic SDLC

**For:** a session or engineer starting cold on this repo
**Written:** 2026-09-18. **Updated:** 2026-09-23 — all 26 tasks implemented.
**State:** implementation **complete**. All 26 tasks across all 10 phases
are done, tested, and committed — see [todo.md](./todo.md) for the
day-by-day narrative and [plan.md](./plan.md) for each task's own
"Done" write-up (acceptance criteria checked, what was verified, and
every honest finding surfaced along the way, including ones that don't
flatter the result). **Section 9 below is new** and is probably the
most load-bearing thing to read if you are picking this repo up cold:
several tasks (T6's real quality pass, T8, T24) needed a real LLM call
and none of this work ever had one available — read it before assuming
anything here required a paid API key.

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
- `AgenticPolicyEngine` defaults to `legacy` mode, which **forces `enforcedOutcome: 'allowed'`** regardless of the decision — `v3/@claude-flow/security/src/policy/evaluator.ts:124`. This is a SITEWIDE chokepoint for the entire CLI/MCP surface (ADR-324), not scoped to this plan — **T16 deliberately did NOT change it** (confirmed with the user first); the gate instead landed as its own always-on precondition check independent of this engine's mode. See plan.md's T16 Done note.
- MCP policy enforcer is opt-in behind `RUFLO_MCP_ENFORCE_POLICY=1` and only rate-limits.
- The Claude Code hook handler exits **1** where blocking needs **2**, so `[BLOCKED]` never blocks. `pre-edit` is wired in settings.json to a handler that does not exist.
- Autopilot is never installed by `init`, its check returns exit 0, and **`'failed'` is in `TERMINAL_STATUSES`** — a failed task counts as done. We do not use it.
- ~~`predictedCostUsd` is hardcoded `0`~~ — **fixed by T12** (2026-09-21): now prices the real tokenized task text via `gpt-tokenizer`, an input-only floor pending T9/T10's real estimator (which then landed and supersedes it).
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
| D5 | Calibration set budget is $50, about $2-3 per task (revised down to $30 before T8 ran; real spend was $0 — see D6) |
| D6 | With no real LLM key available, the implementing session itself does the reasoning any task needing a real model call requires (T6/T8/T24), labelled `agent-inferred` with tokenizer-approximated cost, never auto-confirmed — see §9 |

Also settled: quoting ships first (Phase 2); estimator v0 is nearest-neighbour, not regression; every quote is a range with confidence, never a point estimate; failure routes to `Blocked`, never `Done`.

## 9. How this got built with no real LLM API key

**No implementing session ever had `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`,
or `OLLAMA_API_KEY` configured.** This was confirmed directly, not assumed —
`env | grep -i anthropic` came back empty, and Claude Code's own login is a
macOS Keychain-scoped session/OAuth credential (`"Claude Code-credentials"`),
not a portable bearer token `callAnthropicMessages` (the primitive every real
LLM call in this codebase goes through) can use. Several tasks structurally
need a real model call — T6's decomposition quality pass, T8's calibration
pilot, T24's inferred-requirement extraction — and the pipeline's own real
code paths (`decompose.ts`, `backfill/infer.ts`,
`scripts/run-calibration-pilot.mjs`) all correctly refuse to spend without
real credentials, confirmed by running them for real and getting a clean
`No LLM provider configured` error, never a crash and never a silent
fallback. **That refusal was never patched around or weakened.**

**What happened instead, established at T8 and then generalized to every
later task that hit the same wall (the user's own direction: "use the
AI/claude/codex etc current session as the real llm"):** the AI coding
session doing the implementation work — this one — did the actual reading
and reasoning itself, in-conversation, using its own real tool calls (real
file reads, real git log, real dependency lists), and wrote the result
into the exact same real record substrate a genuine API call would have
produced. Nothing about the record format, validation, or downstream
gates changed — only where the "model call" came from. Every such record
is labelled honestly, not passed off as a real API response:

- **Token/cost is approximated**, never taken from a real `usage` object —
  via this repo's own local tokenizer (`gpt-tokenizer`, cl100k_base,
  `src/ruvector/token-count.ts`) on the real text actually produced, priced
  against the **nearest real entry in `model-prices.ts`** (this session's
  real model has no table entry of its own — `anthropic/claude-sonnet-4-6`
  is the stated proxy throughout, not the originally-planned tier).
- **Provenance is `agent-inferred`**, same as any other machine-produced
  proposal — never `human`, never silently indistinguishable from an
  authored record. Where the schema supports it (T24's requirements and
  decisions), a real `confidence` score travels with it too.
- **Nothing produced this way is auto-accepted.** T24's own inferred
  requirements/decisions are written `status: draft`; this session never
  confirmed its own proposals — that step is left for an actual human,
  deliberately, since self-confirming would be exactly the trust failure
  provenance-tagging exists to prevent.

Where this was used, concretely: T8's 16 real calibration task records
(`docs/tasks/TASK-001`–`016`); T6's real quality pass producing
REQ-001/002/003 and their 15 decomposed tasks (`TASK-017`–`031`); T24's
real REQ-004/DEC-002 (`v3/@claude-flow/cli/src/ruvector/estimator/`, this
session's own module, run through the real `backfill infer` command via
`--from-file` after the reasoning was done in-conversation). Each of
these runs surfaced real bugs in the pipeline it was exercising (T21's
readability validator mis-splitting fenced code blocks and paragraph
breaks; `writeTaskRecord` writing records that claimed `done` without
earning it) — the substitute path is not a mock, it exercises the same
real validation and write code a genuine API call would hit.

**Separately, and not to be confused with the above:** ruflo's own local
memory (`ruflo memory store` / `memory search`) needs **no API key at
all**, and never did — confirmed by direct code audit, not inferred from
docs. It embeds locally via `Xenova/all-MiniLM-L6-v2` (ONNX, downloaded
once from a public CDN, no auth) into a local sql.js/HNSW vector index.
This was real, working, zero-cost infrastructure sitting unused before
this session. Per the user's own direction, it is now used as a manual
operating habit: after each substitute-LLM pass above, the pattern and
what it found is written to the `patterns` namespace with
`ruflo memory store`, and spot-checked retrievable afterward with
`memory search` — not wired into any shipped command automatically, a
discipline this session (and the next one) follows by hand.

**If real credentials show up later:** nothing here needs to be undone.
`decompose.ts`, `backfill/infer.ts`, and the calibration pilot script all
still take a real `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`/
`OLLAMA_API_KEY` on their normal, untouched code path — the substitute was
a session-level workaround for *this* implementing session having no key,
not a permanent architecture change. Re-running any of T6/T8/T24 for real
would produce records in the exact same shape, just with `usage`-sourced
tokens instead of a tokenizer approximation.

Commands: `npm test` (vitest), `npm run build` (tsc), both at root and in `v3/@claude-flow/cli`.

## 10. House rules that bite

From `CLAUDE.md`: never save working files to the root folder; `/src`, `/tests`, `/docs`, `/config`, `/scripts`, `/examples`. Keep files under 500 lines. Read a file before editing it. Never commit secrets or `.env`.

Publishing is a separate, explicitly authorised action — three packages in lockstep (`@claude-flow/cli`, `claude-flow`, `ruflo`). Do not publish as part of normal work.
