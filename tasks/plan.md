# Implementation Plan: Tool-Neutral Agentic SDLC

**Base:** our fork of ruflo, pinned at v3.42.3 (`6f0ed7112`)
**Companion doc:** the Agentic SDLC Build Plan (architecture and rationale)
**Status:** decisions D1-D5 approved 2026-09-18, nothing blocked — no code written yet

---

## Overview

We are building an agentic software development lifecycle that any AI coding tool can drive — Claude Code, Cursor, Codex, or any MCP client. The workflow turns a requirement into a merged change, quotes what it will cost in tokens before building, documents every requirement/decision/task as a validated record, refuses to let mandatory steps be skipped, runs unattended to a quality bar, and writes and runs its own tests.

Eight requirements define done. They are not eight separate features: seven of them are projections over one spine, which is the typed record store.

---

## Architecture decisions

### AD-1: The record is the gate, not the prompt

**Decision:** Phase transitions are gated on validated record state. An agent cannot start implementation because the engine will not give it implementation context without an accepted spec record.

**Why this matters:** An instruction in `CLAUDE.md`, `.cursorrules` or `AGENTS.md` is advisory in every tool. We audited nine spec-workflow projects; every claimed gate is a string in a prompt file that an agent can ignore, and the strongest of them only checks that a file exists, not that it was accepted. Prompt-level enforcement cannot satisfy requirement 6. Making the input unavailable can.

### AD-2: Enforcement lives in the MCP client path and CI, nowhere else

**Decision:** The phase gate goes in `authorizeMcpTool` (`v3/@claude-flow/cli/src/services/policy-runtime.ts:376`), called from `callMCPTool` (`v3/@claude-flow/cli/src/mcp-client.ts:265`). It is mirrored in git hooks and CI.

**Why this matters:** The obvious seam — the server-side policy check at `v3/@claude-flow/cli/src/mcp-server.ts:653` — is stdio-only, so switching transport bypasses it, and it receives only a tool name and a session id. The client-side call sits on every path including HTTP and the CLI, and already receives tool input and context. Only two surfaces block identically across tools: an MCP error, and CI.

**Known limit, accepted:** an MCP gate cannot see a tool's built-in file editor. We are not preventing edits. We are preventing unspecified work from becoming a commit, and unverified commits from becoming merges.

### AD-3: Adopt Graphify and a DocOps fork; build the rest

**Decision:** Graphify (Apache-2.0 + MIT) for code mapping, used as-is over MCP. DocOps (MIT) forked into our repo for the record substrate. Everything else we build.

**Why this matters:** Graphify has already indexed this repo — 3,667 files, 57,751 nodes, 81,511 edges, built from our current commit, zero token cost. Building our own indexer costs 6-12 weeks to parity and never stops costing. DocOps is the only project with genuinely typed records, generated JSON Schema, and a machine-checked rule that every task cites a decision or context. That alignment contract is exactly our spine, already written. We fork rather than depend because it is a one-person project, one star, untouched since May.

### AD-4: Failure is never a terminal state

**Decision:** A failed task moves to `Blocked`, not `Done`.

**Why this matters:** The inherited autopilot puts `'failed'` in `TERMINAL_STATUSES` (`autopilot-state.ts:33`), which silently drops work. Anything that treats failure as completion will quietly lose tasks and report success.

### AD-5: Estimator v0 is nearest-neighbour, not regression

**Decision:** Quote by finding similar past tasks and reporting the range they actually cost. Regression comes later, at milestone 8.

**Why this matters:** Quoting is the team's first priority, and a regression needs data we will not have on day one. Nearest-neighbour works with twenty examples and improves smoothly. Vector search over records already exists in the fork, so this is a small build rather than an ML project.

### AD-6: We never ship a point estimate

**Decision:** Every quote is a range with a confidence level, and variance against actuals is published from the first delivered task.

**Why this matters:** Agentic work has a long tail — a task needing three retries costs roughly four times one that lands first try. A confident wrong number destroys trust in the whole programme, and quoting is the first thing the business will see.

---

## Dependency graph

```
Graphify adopted (T1)          DocOps forked (T2)
        │                              │
        │                              ▼
        │                    Record schemas (T3)
        │                              │
        │                    ┌─────────┼─────────┐
        │                    ▼         ▼         ▼
        │              Record CLI  Citation   Decomposition
        │                 (T4)     contract      (T6)
        │                    │       (T5)         │
        │                    └─────────┼──────────┘
        │                              │
        ▼                              ▼
  Backfill (T22-T24)          Corpus + calibration (T7, T8)
                                       │
                                       ▼
                              Feature extractor (T9)
                                       │
                                       ▼
                              Estimator v0 (T10)
                                       │
                                       ▼
                          quote command + MCP tool (T11)  ◄── FIRST DEMO
                                       │
                                       ▼
                              Actuals + variance (T12, T13)
                                       │
                                       ▼
                        State machine (T14) → Gate (T15) → CI (T16)
                                       │
                                       ▼
                     Test-gated done (T17, T18, T19)
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                   Plain English  Adapters     Autonomy
                      (T20)      (T21)        (T25, T26)
```

Build order follows this bottom-up. The one hard constraint is that records precede everything, because a task record is the unit we estimate over and the unit we gate on.

---

## Phase 0: Adopt

### Task 1: Wire Graphify in as an MCP server with CI refresh

**Description:** Register Graphify's MCP server in our `.mcp.json` template so every tool target sees it. Add a CI job that refreshes the graph on merge and fails if the graph's recorded commit has drifted from `HEAD`.

**Why this matters:** The graph is our only real map of the codebase — the fork has no symbol table, no dependency graph and no index of its own. Every backfill and impact-analysis step depends on it. A stale graph is worse than no graph, because agents will confidently reason about code that has moved; the report itself tells you to compare its recorded commit against `git rev-parse HEAD`, so we automate that rather than trusting memory.

**Acceptance criteria:**
- [x] Graphify MCP server appears in the generated `.mcp.json` and answers a query
- [x] CI job refreshes the graph and fails the build when the recorded commit is behind `HEAD`
- [x] Refresh uses the incremental path and reports zero token cost

**Verification:**
- [ ] Manual: query the graph from Claude Code and from one non-Claude tool
- [ ] CI: push a commit touching a source file, confirm the refresh job runs and passes
- [x] Check `graphify-out/GRAPH_REPORT.md` shows the new commit

**Done 2026-09-21, with two verification steps needing a real CI run/second
tool to close out.** Registered `graphify` in `MCPConfig`
(`src/init/types.ts`, on by default in `DEFAULT_INIT_OPTIONS`/
`FULL_INIT_OPTIONS`) and in `mcp-generator.ts` — invoked as
`python3 -m graphify.serve graphify-out/graph.json`, not via npx like the
Node-based servers, since it's a Python package (`pip install graphifyy`).
Marked `optional: true` so a clone without Python graphify installed doesn't
break the other registered servers. 5 new tests + the existing `#2206`
regression suite (fixed to include the new required field) all pass.

**Real discovery that changed the CI design from the plan's original
framing:** `graphify-out/` is `.gitignore`'d — nothing is committed, so a
fresh CI runner starts with no graph, not an existing one to "refresh". And
semantic (non-code) extraction is normally done by Claude Code dispatching
Agent subagents — a headless runner can't do that without a
GEMINI_API_KEY/GOOGLE_API_KEY secret, which isn't configured. Raised this to
Sairam; decision: **CI does the free AST-only refresh always and never
blocks merges on the semantic gap** (a human runs `/graphify --update`
interactively when convenient). `.github/workflows/graph-refresh.yml`
implements exactly that: restores a rolling Actions cache of `graphify-out/`
(works cold on a cache miss too — `graphify update` builds an AST-only
baseline from nothing), runs `python3 -m graphify update .` (verified
locally: no network call on this path, real run against this repo did
0 nodes' worth of LLM work and finished in seconds), runs the tool's own
cron-safe `check-update` (always exits 0, only ever posts a job-summary
warning), asserts `GRAPH_REPORT.md`'s recorded commit equals `HEAD` after a
successful update (verified both the pass case and, by deliberately
corrupting the report and restoring it, the fail case), then saves the
cache unconditionally. The two open verification checkboxes need a real
GitHub Actions run and a second AI tool (Cursor/Codex) to close out — both
require infrastructure (CI execution, another tool's MCP client) outside
what this session can drive directly.

**Dependencies:** None
**Files likely touched:** `v3/@claude-flow/cli/src/init/` (mcp config template), `.github/workflows/graph-refresh.yml`
**Estimated scope:** S

---

### Task 2: Fork DocOps into the repo

**Description:** Vendor DocOps under a path we own, pin it, strip what we do not need, and get its validator running on a throwaway example. Do not add it as an npm dependency.

**Why this matters:** DocOps gives us three things we would otherwise spend a week writing: typed record definitions, generated JSON Schema per type, and a validator enforcing that every task cites a decision or context document. That citation rule is the mechanism that stops agent work drifting from intent, and it is checkable by a script rather than a reviewer. We fork rather than depend because the upstream is one person's project, one star, and has not moved since May — an unmaintained dependency in the foundation layer is a liability.

**Acceptance criteria:**
- [x] DocOps source vendored, licence and attribution preserved (MIT)
- [ ] `validate` runs and rejects a task that cites nothing — **scope moved to T4**, see note below
- [x] No runtime npm dependency on the upstream package

**Verification:**
- [ ] Create a valid record set, validate passes — deferred to T4 (no validator exists to run yet)
- [ ] Remove the citation from a task, validate fails with a clear message — deferred to T4
- [x] `npm run build` succeeds — no new build-graph member added (see note), so no new breakage; the package already had 472 pre-existing tsc errors unrelated to this (see T12's note)

**Done 2026-09-21, with one acceptance criterion's scope corrected.**
**Real discovery: DocOps is a Go CLI tool** (`go.mod`, `cmd/`, `internal/`
layout, 274 files) — not a JS/TS library. The plan's framing ("new
`v3/@claude-flow/docops/` package", "no runtime npm dependency on the
upstream package") assumed a JS/TS vendoring shape that doesn't exist here.
Raised this to Sairam; decision: **vendor a reference-only copy, no Go
build, nothing runs at runtime.** T3 reads the real design and reimplements
the schemas/validator natively in TypeScript.

Vendored under `v3/@claude-flow/docops/` (no `package.json` — not a pnpm
workspace member, confirmed `pnpm-workspace.yaml`'s `@claude-flow/*` glob
only registers directories with one, so this is inert to the build):
- `LICENSE` (verbatim MIT) + `ATTRIBUTION.md` (pinned commit, full
  included/excluded file list and why, and a correction to HANDOVER.md §7's
  "untouched since May" claim — the upstream actually has an active `dev`
  branch and unreleased `0.7.0` work past the last `v0.6.0` tag; doesn't
  change the fork-not-depend call, but the stated reason was wrong)
- `vendor/schema/{types,validate,jsonschema}.go` — the CTX/ADR/TP struct
  defs, the citation-rule validation (confirmed by reading the code: `must
  cite at least one ADR or CTX (ADR-0004 alignment rule)`), and the
  JSON-Schema emitter
- `vendor/validator/validator.go` — cross-document edge/supersede checks
- `vendor/docs-examples/` — the three upstream ADRs that motivated the
  schema (0002 bare-minimum frontmatter, 0003 filename-as-ID, 0004 the
  citation rule itself) plus one real `CTX-001` example

Stripped: all CLI plumbing (`init`/`serve`/`audit`/`amender`/`upgrader`/
release tooling), the HTML viewer, all `_test.go` files, and DocOps's own
self-hosted docs beyond the four example files — none of it is design
reference for schema/validator work.

**What this means for T4:** "`validate` runs and rejects a task that cites
nothing" is really T4's acceptance criterion now (`ruflo req/task/validate`
is a TypeScript CLI, not a wrapped Go binary) — flagging so whoever picks up
T3/T4 doesn't assume it's already satisfied.

**Dependencies:** None
**Files likely touched:** new `v3/@claude-flow/docops/` package, root workspace config
**Estimated scope:** M

---

### Checkpoint: Phase 0
- [ ] `npm test` passes, `npm run build` succeeds
- [ ] Graph queryable from two different AI tools
- [ ] Record validation demonstrably rejects an uncited task
- [ ] **Human review before proceeding**

---

## Phase 1: A record exists and validates (vertical slice A)

### Task 3: Define the three record schemas

**Description:** Adapt the forked schemas to our needs: requirement, decision, task. Markdown body plus typed front matter. Every record carries a stable id, status, created and updated dates, citations, a content hash, and a provenance field. Tasks additionally carry estimate, actuals, and done criteria.

**Why this matters:** This is the spine. Seven of the eight requirements are projections over it — gating reads status, the estimator reads task fields, QA writes the done field, the plain-English validator reads the human-facing fields. Getting the field set wrong here forces rework in every later phase. The provenance field specifically prevents the failure where a requirement the AI guessed from old code becomes indistinguishable from one a human wrote; without it the substrate becomes untrustworthy within a month.

**Acceptance criteria:**
- [x] Three schemas defined, each generating a JSON Schema for editor validation
- [x] Citation contract enforced: a task must cite at least one requirement or decision
- [x] Provenance field distinguishes human-authored from agent-inferred
- [x] Records diff and merge sensibly as files in git (plain markdown + YAML frontmatter, one file per record — see below)

**Verification:**
- [x] Unit tests cover: valid record, missing citation, unknown field, bad status
- [x] `npm test -- --grep "record schema"` passes — literal flag doesn't exist in this repo's vitest 4 (`--grep` is a Mocha/Jest-ism); the equivalent `vitest run --testNamePattern "record schema"` isolates and passes all 18 matching tests
- [x] Manual: open a record in an editor, confirm schema autocomplete works — didn't open an actual editor (no interactive session here), but validated the generated JSON Schema files for real with `ajv`: a well-formed task passes, one with `extraField` correctly fails on `additionalProperties`, confirming the schema an editor would load is faithful, not just "didn't throw during generation"

**Done 2026-09-21.** Built the real package this time (T2 left `v3/@claude-flow/docops/`
with no `package.json`, deliberately — see T2's note). New:
- `src/schemas/base.ts` — shared fields (`id`, `title`, `createdAt`/`updatedAt`,
  `citations`, `contentHash`, `provenance`) and the `RecordIdSchema` id pattern.
  Renamed DocOps's "Context" to "Requirement" (REQ-) to match the plan's own
  language; added a `status` field DocOps's Context lacks, per Task 3's own
  description.
- `src/schemas/{requirement,decision,task}.ts` — Zod schemas, `.strict()` (unknown
  keys rejected). `TaskSchema` overrides the base's optional `citations` with
  the actual citation contract: non-empty, and not satisfiable by other
  tasks alone (`.refine` checking for a REQ- or DEC- id) — same rule as
  upstream's ADR-0004, ported as designed rather than copied.
  `estimate`/`actuals`/`doneCriteria` are new fields DocOps has no
  equivalent for, shaped to match T10/T13/T18's stated contracts
  respectively (each still a placeholder those tasks will formalize).
- `src/content-hash.ts` — sha256 of the record body (not the frontmatter,
  which would make the hash depend on itself).
- `src/frontmatter.ts` — splits YAML frontmatter from the markdown body and
  resolves which schema applies from the record's own `id` prefix.
  **Not using `gray-matter`** despite adding it initially: it hard-requires
  js-yaml v3's `safeLoad` at module-load time, and crashes on import under
  this workspace's `pnpm.overrides` forcing `js-yaml >=4.3.0` (v4 dropped
  `safeLoad`) — no option passed to it can work around a crash at require()
  time. Hand-rolled the split against `js-yaml` directly instead; it's a
  few lines and removes the broken dependency entirely.
- `scripts/generate-json-schemas.ts` + checked-in `schemas/*.schema.json` —
  via `zod-to-json-schema`. The `.refine()` business rules (citation count,
  estimate range) don't appear in the generated JSON Schema — expected;
  JSON Schema autocomplete is for field shapes, the real rule enforcement
  lives in the Zod schemas T4's CLI will call.
- 32 tests across 4 files, `npm run build` succeeds for this package cleanly
  (no pre-existing breakage here, unlike `@claude-flow/cli`'s 472 tsc errors).

**"Records diff and merge sensibly as files in git"**: satisfied by design,
not by a committed example — records are one markdown file per record with
YAML frontmatter, a line-based text format, not a JSON blob. T4 (Record CLI)
decides where those files actually live in the repo; adding a real example
there now would presuppose that.

**Dependencies:** T2
**Files likely touched:** `v3/@claude-flow/docops/src/schemas/`, `v3/@claude-flow/docops/src/types.ts`, tests
**Estimated scope:** M

---

### Task 4: Record CLI — create, show, list, validate

**Description:** Add a top-level command for record operations. Registration is a new file exporting a `Command` object plus one line in the loader map at `v3/@claude-flow/cli/src/commands/index.ts:25-106`. Use `v3/@claude-flow/cli/src/commands/advisor.ts` as the shape template.

**Why this matters:** The CLI is the universal fallback. Any tool that can run a shell command can drive the workflow even with no MCP support, which means a tool we have never tested — or a developer working by hand — can still participate. Every MCP tool we expose later should have a CLI equivalent, and this establishes that pattern.

**Acceptance criteria:**
- [x] `ruflo req new|show|list` and `ruflo task new|show|list` work — nested as
  `ruflo record req|task new|show|list` (see naming-collision note below);
  also added `ruflo record decision new|show|list` for the third kind T3 built
- [x] Creating a task without a citation is refused with a message naming what is missing
- [x] `ruflo validate` checks the whole record set — as `ruflo record validate`

**Verification:**
- [x] Tests for each subcommand, happy path and refusal path
- [x] Manual: create a requirement, then a task citing it, then list both —
  ran for real against the compiled CLI binary (`node bin/cli.js record ...`),
  not just unit tests; output included below
- [x] `npm run build` succeeds — for `@claude-flow/cli` specifically: no,
  same 472 pre-existing errors as T12 (unrelated `@claude-flow/cli-core`
  resolution); tsc still emits working output for every file that has no
  error (including this task's own), which is what the manual CLI run below
  actually exercises. Building `@claude-flow/cli-core` and `@claude-flow/docops`
  themselves (both actually depended on) each succeed cleanly with 0 errors.

**Done 2026-09-21.** Real naming collision found before writing any code:
the plan's literal "`ruflo task new`" collides with the EXISTING `ruflo task`
command (swarm/agent runtime task orchestration — create/list/status/cancel,
agent assignment), a completely different concept from a planning-record
Task. Raised this to Sairam; decision: nest everything under `ruflo record`
(`req`/`decision`/`task`/`validate`) rather than as separate top-level
commands — no collision, one discoverable namespace, matches the plan's own
file list (one `records.ts`, not three command files).

New: `v3/@claude-flow/cli/src/commands/records.ts`, registered in
`commands/index.ts`'s lazy-load `commandLoaders` map (same pattern as
`advisor`/`gaia-bench`). Depends on `@claude-flow/docops` as a real pnpm
workspace dependency. Records live at `docs/{requirements,decisions,tasks}/`,
one markdown file per record, filename `<ID>-<slug>.md`; ids auto-increment
by scanning the directory. The citation contract is enforced twice:
`task new` refuses up front (before writing anything) if `--citations` is
empty, with a message naming the actual rule — and separately, the
underlying `TaskSchema.safeParse` still catches the "cites only other
tasks" case, whose message is exactly what gets surfaced. Deliberately did
NOT mark `--citations` `required: true` on the CLI option — that triggers
the parser's own generic "Required option missing" refusal *before* this
command's action runs, pre-empting the actual citation-contract message;
caught this by actually running the refusal path through the real binary,
not just the unit test (the unit test calls the action directly, bypassing
the parser's option-validation layer entirely, so it couldn't have caught
this).

11 new tests (happy path + refusal path per plan's own verification
wording) plus 2 new round-trip tests added to `@claude-flow/docops` for the
serializer T4 needed that T3 hadn't built (parse-only was T3's scope).
Full manual walkthrough via the actual compiled CLI binary
(`node v3/@claude-flow/cli/bin/cli.js`), not simulated:

```
$ record req new --title "Quote a feature before building it"
[OK] Created REQ-001: .../docs/requirements/REQ-001-quote-a-feature-before-building-it.md

$ record task new --title "Fix pricing bugs" --citations REQ-001 --priority p1
[OK] Created TASK-001: .../docs/tasks/TASK-001-fix-pricing-bugs.md

$ record req list                       $ record task list
+---------+--------+-------------------+   +----------+---------+------------------+
| ID      | Status | Title             |   | ID       | Status  | Title            |
+---------+--------+-------------------+   +----------+---------+------------------+
| REQ-001 | draft  | Quote a feature...|   | TASK-001 | backlog | Fix pricing bugs |
+---------+--------+-------------------+   +----------+---------+------------------+

$ record validate
[OK] All 2 record(s) valid.

$ record task new --title "Orphan task"     # no --citations
[ERROR] Refusing to create a task with no citations
  A task must cite at least one requirement or decision. Pass --citations REQ-001[,DEC-002,...]
```

Also ran a broad regression check: full `@claude-flow/cli` test suite before
vs. after this task's changes (git stash comparison, same technique as
T12). Before: 62 failed files / 169 failed tests. After: 60 failed files /
161 failed tests — my changes reduce failures (building `cli-core`'s dist
as a side effect of verifying this task fixed some pre-existing breakage);
the remaining ~60 failures are pre-existing native-binary issues (sharp,
onnxruntime, ruvllm-wasm) unrelated to this task, present on a clean tree.

**Dependencies:** T3
**Files likely touched:** `v3/@claude-flow/cli/src/commands/records.ts`, `v3/@claude-flow/cli/src/commands/index.ts`, tests
**Estimated scope:** M

---

### Task 5: Citation contract as a git pre-commit hook

**Description:** A pre-commit hook that validates every changed record against its schema and checks the citation contract. A pre-push hook placeholder that will later run tests.

**Why this matters:** This is tier 2 of three enforcement tiers, and it is the first one that works regardless of which tool produced the change — including a human typing by hand. It gives fast local feedback so a developer learns the rule in seconds rather than at CI time. It is bypassable with `--no-verify`, which is why CI repeats the check later; treat this tier as feedback, not as the contract.

**Acceptance criteria:**
- [x] Committing an invalid record fails with a readable message
- [x] Committing a valid record set succeeds
- [x] Hook only inspects changed records, so commit time stays under a second

**Verification:**
- [x] Manual: stage a broken record, attempt commit, confirm refusal
- [x] Manual: confirm a normal code-only commit is unaffected
- [x] Time a commit on a large change set

**Done 2026-09-21.** `scripts/hooks/pre-commit` (git-invocable, extensionless —
git hooks live in `.git/hooks/` at the **repo root**, a different tree from
the `v3/` pnpm workspace where T3/T4's actual validation logic lives; the
hook loads `v3/@claude-flow/docops/dist/index.js` directly across that
boundary). Checks only staged files matching `docs/{requirements,decisions,
tasks}/*.md`, reads their STAGED blob content via `git show :<path>` (not
the working-tree file — those can differ if edited again after `git add`),
and validates via `@claude-flow/docops`. `scripts/hooks/pre-push` is the
placeholder the description calls for — genuinely empty; T19/T20 (test-gated
done) will fill it in. Split the decision logic into a pure
`scripts/hooks/pre-commit-lib.mjs` (8 unit tests,
`scripts/__tests__/pre-commit-hook.test.mjs`, matching this repo's own
existing convention of testing a script's `.mjs` sibling in isolation) from
the I/O wiring (git subprocess calls, loading docops, `process.exit`),
since the git-hook file itself has no extension and can't be cleanly
imported by a test.

Installed for real via `scripts/install-git-hooks.mjs`, wired to the root
`package.json`'s new `prepare` script — verified end-to-end: running
`npm install` at the repo root actually re-installed the hooks
automatically as a side effect, confirmed by its own log output.
`--no-verify` bypass is intentional per the plan's own tier reasoning; a
soft-fail (allow + warn) also covers the case where `docops` isn't built
yet, so a fresh clone's first commit isn't blocked by an unrelated setup
gap.

All three manual verifications actually run against the real installed
hook (not simulated): staged an invalid record (bad `status` enum) →
blocked, exit 1, message named the exact field and rule; staged a valid
record → exit 0; staged a non-record file only → exit 0 in 75ms (never
touches docops — confirms the "changed records only" fast path); staged 20
record files → 687ms, still comfortably under a second. Every test file was
created, staged, checked, then unstaged and deleted — the repo's actual
`docs/` tree is untouched.

**Found while doing this, worth flagging separately from T5 itself:**
`plugins/ruflo-adr/` already exists in this repo — a Claude Code
agent/skill plugin (not a `ruflo` CLI command) that manages ADR lifecycle
via AgentDB indexing at `docs/adr/` (grep/blame code-linking, no formal
schema or citation contract). Neither HANDOVER.md nor plan.md mentioned it —
a fourth instance this session of the plan being written without fully
surveying the existing codebase (after: DocOps being Go not JS, `ruflo
task` colliding, and T1's graphify-out being gitignored). No actual
conflict for T3–T5's work (different directory — `docs/adr/` vs `docs/
decisions/` — and `docs/adr/` doesn't exist on disk, so the plugin has
apparently never been run here), but two competing ideas of "where ADRs
live" in one repo is worth resolving deliberately rather than by accident.
Flagging for whoever plans Phase 8 (backfill) or does a later architecture
pass — not blocking anything now.

**Dependencies:** T3, T4
**Files likely touched:** `.husky/` or `scripts/hooks/`, `package.json`
**Estimated scope:** S

---

### Checkpoint: Phase 1
- [ ] A requirement and a task can be created, linked, listed and validated
- [ ] Invalid records are refused at CLI and at commit
- [ ] All tests pass, build clean
- [ ] **Human review before proceeding**

---

## Phase 2: Quote a feature (vertical slice B) — the first demo

### Task 6: Requirement decomposition agent

**Description:** An agent that takes a requirement record and proposes task records, each citing the requirement. Consumes the Graphify graph to ground itself in which files and modules exist.

**Why this matters:** A quote is a rollup over task records, so nothing can be estimated until a requirement has been decomposed. This is also the step that makes the quote explainable: when a stakeholder asks why a feature costs what it costs, the answer is the task list, not an opaque number. Grounding it in the real code graph is what stops it inventing modules that do not exist.

**Acceptance criteria:**
- [x] Given a requirement, produces 3-15 task records that validate
- [x] Each task cites the source requirement
- [x] Tasks reference real files or modules from the graph
- [x] Output is reviewable and editable before it is committed

**Verification:**
- [ ] Run against three requirements of differing size, inspect output quality manually — **not done**: this needs a real, paid LLM call, and the user held T8 back specifically because it spends money. Verified everything else about the pipeline (prompt building, response parsing, grounding, record writing) end-to-end via `--from-file` and a mocked LLM call instead, at $0. Flag for the user: do they want to authorize a few real decompose calls to judge actual output quality, same as the T8 decision?
- [x] All produced records pass `ruflo validate` — verified via the real compiled CLI: created a real requirement, decomposed it via `--from-file`, `--yes`, then ran `ruflo record validate` — all records (requirement + tasks) pass
- [x] Confirm referenced paths exist in the repo — verified via the real compiled CLI with a real graph fixture: a proposal citing one real file (`src/pricing.ts`, present in the graph) and one hallucinated file (`src/totally-made-up-file.ts`, not in the graph) produced a task record containing only the real path

**Done 2026-09-22, pending a real-LLM quality pass.** New CLI subcommand
`ruflo record req decompose <id>` in `src/commands/decompose.ts`. Reuses
`callAnthropicMessages` from `mcp-tools/agent-execute-core.ts` (the same
primitive `agent_execute` uses) rather than the heavier swarm agent-store
machinery — a one-shot call needs no persistent agent. Grounding reuses
T9's `groundInGraph()` (exported from `estimator/features.ts` for this).
Because a real call costs real money, this is **dry-run by default**
(prints proposals, writes nothing) — `--yes` commits them, `--from-file`
skips the LLM call entirely and takes a (possibly hand-edited) proposals
JSON, which is the "reviewable and editable before committed" loop:
dry-run → save output → edit → `--from-file edited.json --yes`. Grounding
validation (dropping any file the model — or a hand-edit — references that
isn't actually in the graph) applies on BOTH paths, not just the live-LLM
one.

Extracted the shared record-storage helpers (`kindDir`, `claimAndWriteRecord`,
`slugify`, `findRecordPath`, `resolveBody`, `formatValidationError`, ...)
out of `records.ts` into a new `records-io.ts` — decompose.ts needs them
too, and a direct `records.ts` ↔ `decompose.ts` circular import would have
been fragile (works only if `records.ts` always loads first; breaks if
anything ever imports `decompose.ts` directly, which the test suite does).
This also brought `records.ts` back under this repo's 500-line guideline
(578 → 466).

26 unit tests cover prompt building, response parsing (valid/invalid JSON,
too few/many tasks, missing fields, a markdown-fenced response, non-string
file entries), grounding (keeps real files, drops hallucinated ones), and
the full CLI command via both `--from-file` and a mocked LLM call. **A real
bug was caught only by testing against the real compiled binary, not the
unit tests**: the CLI's flag parser normalizes `--from-file` to
`ctx.flags.fromFile`, not `ctx.flags['from-file']` — the same dual-form
check `resolveBody()` already does for `--body-file`, which I should have
matched from the start. Fixed, with a regression test constructing `ctx`
with the camelCase form directly (a unit test alone would never have found
this, since a hand-built `ctx` object doesn't go through the real parser).

**Dependencies:** T1, T4
**Files likely touched:** agent definition, `v3/@claude-flow/cli/src/commands/records.ts`
**Estimated scope:** M

---

### Task 7: Build the training corpus from the existing trajectory log

**Description:** Extract labelled pairs from `v3/@claude-flow/cli/src/ruvector/router-trajectory.ts` output (`.swarm/model-router-trajectories.jsonl`): task text, complexity score, model, actual input and output tokens, actual cost.

**Why this matters:** This is the single most valuable thing already in the fork for requirement 2. It is a real labelled dataset mapping work description to real consumption, collected automatically, and nobody has used it. It gives the estimator a cold start on day one instead of requiring us to deliver features before we can quote anything. The domain differs from the pilot's, so treat it as a prior, not as ground truth.

**Acceptance criteria:**
- [x] Corpus builder reads the trajectory log and emits normalised training pairs
- [x] Rows with missing or zero token counts are excluded, and the exclusion is counted
- [x] Corpus size and date range are reported

**Verification:**
- [x] Unit test over a fixture log including malformed rows
- [ ] Run against the real log, confirm the row count is plausible and non-zero

**Done 2026-09-21, with one open item.** `src/ruvector/estimator/corpus.ts` parses
the JSONL trajectory log, pairs decision+outcome rows by `task_hash` (latest
wins, same convention as `pairTrajectoryRows`), and excludes+counts rows with
no matching outcome or no usable token count. Returns `corpusSize` and
`dateRange` for the caller to report. 10 fixture-based unit tests cover
malformed lines, unmatched decisions, zero-token exclusion, and the
latest-wins join.
**Could not verify against the real log** — `CLAUDE_FLOW_ROUTER_TRAJECTORY`
is opt-in and this checkout has never had it enabled; `.swarm/model-router-trajectories.jsonl`
does not exist here. `loadEstimatorCorpus` handles that gracefully (empty
corpus, not a throw) rather than fabricating rows to satisfy the check. This
will produce real data once T8's calibration set (or any run with the env
var set) generates rows — flag for whoever picks up T8/T10 to confirm the
row count then.

**Dependencies:** None
**Files likely touched:** `v3/@claude-flow/cli/src/ruvector/estimator/corpus.ts`, tests
**Estimated scope:** S

---

### Task 8: Calibration set — 15 to 20 labelled pilot tasks

**Description:** Deliberately run a representative spread of real tasks from our own codebase, record actual token consumption, and label them. Budget three days and treat it as part of this phase, not overhead.

**Why this matters:** The trajectory corpus is from a different domain. Without pilot-domain examples the first quotes will be wide in a way that looks like the tool is broken rather than honest. Twenty labelled examples is roughly the point at which nearest-neighbour starts producing defensible ranges. This is also the only task in the plan that deliberately spends tokens to create an asset.

**Budget (D5):** 50 US dollars for the whole set, roughly 2 to 3 dollars per task. If we finish under 25 dollars, add more tasks rather than stopping early.

**Acceptance criteria:**
- [ ] At least 15 tasks spanning small/medium/large and different work types
- [ ] Each has recorded actual input and output tokens and cost
- [ ] Each is stored as a task record with actuals populated
- [ ] Total spend stays within the 50 dollar limit, and the actual spend is reported

**Verification:**
- [ ] Records validate
- [ ] Spread check: no single work type is more than half the set
- [ ] Manual review of whether the set looks representative

**Dependencies:** T4, T7
**Files likely touched:** record files, `.swarm/` corpus
**Estimated scope:** M

---

### Task 9: Feature extractor for a task record

**Description:** Given a task record, produce the feature vector used for estimation: complexity score, files likely touched, test layers required, new-code versus change, and citation-closure size. Reuse `analyzeComplexity()` at `v3/@claude-flow/cli/src/ruvector/model-router.ts:836`.

**Why this matters:** The complexity extractor already exists and is already what the router uses to pick a model tier — reusing it means our estimate and our routing decisions agree about how hard a task is, rather than disagreeing for no reason. The missing link in the fork has always been mapping that score to expected tokens; this task builds the input half of that link.

**Acceptance criteria:**
- [x] Extractor returns a stable feature vector for a task record
- [x] Identical input produces identical output
- [x] Files-touched estimate is grounded in the Graphify graph, not guessed

**Verification:**
- [x] Unit tests over fixture records covering each feature
- [x] Determinism test: same record twice, same vector

**Done 2026-09-22.** `src/ruvector/estimator/features.ts` exports `extractFeatures(frontmatter, body, opts)`,
returning `{ complexityScore, filesLikelyTouched, testLayers, isNewCode, citationClosureSize }`.
Complexity reuses the exported `analyzeTaskComplexity()` (the plan's cited
`model-router.ts:836` line number was stale — the function lives at line
901/1540, found by grep, not assumed). Files-touched is grounded in
`graphify-out/graph.json`: task text is reduced to name-style tokens
(kebab/snake/camelCase-aware) and matched against code-node labels,
requiring a file's tokens to be MOSTLY or WHOLLY present in the task text
(all of a 1-2 token filename, a majority of a longer one) rather than any
single substring hit. That threshold isn't cosmetic — a naive
single-keyword substring match, tried first, pulled in 140+ files against
this repo's real 58k-node graph for a two-sentence task description
(verified by running it for real); the token-overlap version returns 15
ranked, genuinely plausible files for the same input, including the actual
target file. No graph on disk degrades to an empty (not fabricated) match
list, matching this repo's established convention. citation-closure walks
citations/dependsOn/supersedes/related transitively across the local
`docs/` tree, cycle-safe. 13 unit tests (`__tests__/ruvector/estimator/features.test.ts`)
cover each feature independently, the token-overlap threshold specifically
(including the exact false-positive case found via manual testing), the
15-file cap, and determinism (same record + repo state twice → `toEqual`).

**Dependencies:** T1, T3
**Files likely touched:** `v3/@claude-flow/cli/src/ruvector/estimator/features.ts`, tests
**Estimated scope:** M

---

### Task 10: Estimator v0 — nearest neighbour with ranges

**Description:** Given a feature vector, find the most similar corpus entries and return a token range with a confidence level. Apply a retry multiplier. Never return a point estimate.

**Why this matters:** This is requirement 2, the team's stated first priority. Nearest-neighbour rather than regression because it degrades gracefully: with twenty examples it gives a wide but honest range, and it tightens as history grows, with no retraining step. Returning a range rather than a number is not a nicety — a single figure will be wrong and will be quoted back at us.

**Acceptance criteria:**
- [ ] Returns low, high, and confidence for a task record
- [ ] Confidence drops when no near neighbour exists, and says so
- [ ] Retry multiplier is configurable and documented
- [ ] Refuses to emit a point estimate anywhere in the API

**Verification:**
- [ ] Unit tests: dense neighbourhood gives narrow range, sparse gives wide plus low confidence
- [ ] Hold-out test over the calibration set: actual falls inside the quoted range for most tasks
- [ ] Record the hit rate — this is our accuracy baseline

**Dependencies:** T7, T8, T9
**Files likely touched:** `v3/@claude-flow/cli/src/ruvector/estimator/predict.ts`, tests
**Estimated scope:** M

---

### Task 11: `ruflo quote` command and MCP tool

**Description:** Roll estimates up across a requirement's tasks, price against the model table, and present the result. Ship as both a CLI command and an MCP tool so every tool target can call it. MCP registration is a new file exporting `MCPTool[]` plus one import and spread at `v3/@claude-flow/cli/src/mcp-client.ts:133-194`.

**Why this matters:** This is the first thing the business sees and the milestone that justifies the programme. Exposing it over MCP as well as CLI is what makes it tool-neutral from day one rather than retrofitted later. The output must show the assumptions driving the range, because a quote nobody can interrogate is a quote nobody will trust.

**Acceptance criteria:**
- [ ] `ruflo quote <requirement-id>` prints a range, a confidence level, and the per-task breakdown
- [ ] Quoting a whole backlog rolls up across requirements
- [ ] The same result is available via an MCP tool call
- [ ] Output names the assumptions: retry multiplier, corpus size, neighbour count

**Verification:**
- [ ] Tests for CLI and MCP paths
- [ ] Manual: quote from Claude Code and from one non-Claude tool, compare output
- [ ] Manual: confirm a stakeholder-readable summary

**Dependencies:** T6, T10, T12
**Files likely touched:** `v3/@claude-flow/cli/src/commands/quote.ts`, `v3/@claude-flow/cli/src/mcp-tools/quote-tools.ts`, `mcp-client.ts`, tests
**Estimated scope:** M

---

### Task 12: Fix the inherited pricing and token-counting bugs

**Description:** Four fixes. Collapse the two divergent price tables to one source. Make unknown models fail loudly instead of falling back to a made-up rate. Replace `length / 4` token counting with a real tokenizer. Populate `predictedCostUsd`, currently hardcoded to `0` at `v3/@claude-flow/cli/src/ruvector/model-router.ts:740,746`.

**Why this matters:** Every number our quote produces flows through this code. Two price tables that disagree on the same model means two parts of the system quote different costs for identical work. A silent fallback price for unknown models means a quote can be confidently wrong with no signal. And character-count-over-four is roughly right for English prose and materially wrong for code, which is what we are actually estimating. These are small fixes that determine whether requirement 2 is credible at all.

**Acceptance criteria:**
- [x] One price table; the duplicate is deleted, not deprecated
- [x] Unknown model throws with the model name, rather than defaulting
- [x] Token counts come from a real tokenizer
- [x] `predictedCostUsd` carries a real figure

**Verification:**
- [x] Unit tests: known model prices correctly, unknown model throws
- [x] Tokenizer test against a known code sample with a known token count
- [x] `npm test` passes, including existing router tests

**Done 2026-09-21.** `gaia-bench.ts`'s duplicate `MODEL_PRICING` table is gone —
it now imports `blendedPrice`/`costUsd` from `model-prices.ts` and validates
every `--models` entry up front (fails before spending tokens, not after).
`costUsd`/`blendedPrice` throw `UnknownModelPriceError` naming the model
instead of guessing a rate; `router-trajectory.ts`'s best-effort telemetry
catches that specific error and omits `cost_usd` rather than dropping the
whole outcome row. Added `gpt-tokenizer` (cl100k_base) via
`src/ruvector/token-count.ts`, replacing the `length/4` guess — plugged in at
`model-router.ts`'s `predictedCostUsd` (previously hardcoded `0`), which
prices the tokenized task text at the picked tier's rate. That's an
input-only floor (output size is unknown pre-execution) — marked with a
`ponytail:` comment for T9/T10 to supersede. New tests:
`__tests__/ruvector/model-prices.test.ts`, `__tests__/ruvector/token-count.test.ts`;
updated `__tests__/neural-router.test.ts`'s unknown-model assertion. 105
tests pass across all touched/at-risk suites. Full `npm run build` was not
re-verified end-to-end — it fails on a clean checkout too (472 pre-existing
tsc errors, unrelated `@claude-flow/cli-core` resolution — see HANDOVER.md
§4); isolated type-checks of every touched file are clean.

**Dependencies:** None
**Files likely touched:** `v3/@claude-flow/cli/src/ruvector/model-prices.ts`, `gaia-bench.ts`, `model-router.ts`, tests
**Estimated scope:** M

---

### Checkpoint: Phase 2 — FIRST DEMO
- [ ] A requirement can be decomposed and quoted end to end
- [ ] The quote is a range with stated confidence and visible assumptions
- [ ] The same quote is reachable from at least two different AI tools
- [ ] Hold-out hit rate recorded as the accuracy baseline
- [ ] **Demo to stakeholders. Human review before proceeding.**

---

## Phase 3: Close the estimation loop (vertical slice C)

### Task 13: Capture actuals into the task record

**Description:** When a task completes, write real token and cost consumption into its record, sourced from the trajectory log and the budget receipts.

**Why this matters:** Without this the estimator never improves and the quote is a one-way guess. The fork already has `estimated_usd` and `actual_usd` columns in an unused budget ledger, which shows someone intended this and never wired it. Closing the loop is what turns quoting from a demo into a capability.

**Acceptance criteria:**
- [ ] Completed tasks carry actual input tokens, output tokens, and cost
- [ ] Actuals feed back into the corpus automatically
- [ ] A task that failed records what it consumed before failing

**Verification:**
- [ ] Run a real task end to end, confirm actuals land in the record
- [ ] Confirm the corpus row count increases

**Dependencies:** T10, T11
**Files likely touched:** estimator corpus, record writer, tests
**Estimated scope:** M

---

### Task 14: Variance report

**Description:** A command that reports quoted versus actual across delivered tasks, with the trend over time.

**Why this matters:** Requirement 6 of trust, not of the spec: a quote that visibly improves is persuasive, a quote that was quietly wrong is not. Publishing variance from the first delivered task is how we avoid the failure mode where an early bad number damages confidence in the whole programme. It is also our only feedback signal on whether the estimator is working.

**Acceptance criteria:**
- [ ] `ruflo variance` shows quoted versus actual per task and in aggregate
- [ ] Shows the hit rate: how often actual fell inside the quoted range
- [ ] Trend over time is visible

**Verification:**
- [ ] Tests over fixture data
- [ ] Manual: run against the calibration set, sanity-check the numbers

**Dependencies:** T13
**Files likely touched:** `v3/@claude-flow/cli/src/commands/quote.ts`, tests
**Estimated scope:** S

---

### Checkpoint: Phase 3
- [ ] Estimate and actual are both recorded, and variance is reportable
- [ ] Corpus grows automatically as work completes
- [ ] **Human review before proceeding**

---

## Phase 4: The gate (vertical slice D)

### Task 15: Task state machine with transition preconditions

**Description:** Implement the state machine: Drafted, Specified, Implementing, Verifying, Done, Blocked. Each transition has a precondition checked against record state. Failure routes to `Blocked`, never to `Done` (AD-4).

**Why this matters:** This is the object the gate enforces against. Without it, "mandatory step" has no definition to point at. Modelling `Blocked` as a real state with a named reason is what makes escalation legible — the system can say which decision it is waiting on rather than just stopping.

**Acceptance criteria:**
- [ ] All six states and their legal transitions implemented
- [ ] Each precondition is a pure function over record state
- [ ] `Blocked` carries a reason and the condition that would unblock it
- [ ] `'failed'` is not terminal anywhere

**Verification:**
- [ ] Unit tests over every legal and illegal transition
- [ ] Test asserting failure routes to `Blocked`, not `Done`

**Dependencies:** T3
**Files likely touched:** `v3/@claude-flow/docops/src/state-machine.ts`, tests
**Estimated scope:** M

---

### Task 16: Phase gate in the MCP client authorisation path

**Description:** Extend `authorizeMcpTool` to receive the current phase and task record, and to deny a workflow tool call whose precondition is unmet. Return an error naming what is missing and what would satisfy it.

**Why this matters:** This is the tool-neutral enforcement tier and the core of requirement 6 — the same denial reaches Claude Code, Cursor and Codex identically. The error message matters as much as the denial: an agent told "spec record REQ-12 is not accepted; run `ruflo req accept REQ-12`" can self-correct, while one told "denied" will retry blindly and burn budget. Note that `AgenticPolicyEngine` currently defaults to a mode that forces every decision to `allowed` (`v3/@claude-flow/security/src/policy/evaluator.ts:124`) — that default must change or the gate is a no-op.

**Acceptance criteria:**
- [ ] A workflow tool call with an unmet precondition is denied before it executes
- [ ] The denial names the missing condition and the command that fixes it
- [ ] The gate is on by default, not behind an environment variable
- [ ] Non-workflow tool calls are unaffected

**Verification:**
- [ ] Tests: denied path, allowed path, and a non-workflow tool passing through
- [ ] Manual: attempt the same blocked action from two different AI tools, confirm identical refusal
- [ ] Confirm policy mode default no longer forces `allowed`

**Dependencies:** T15
**Files likely touched:** `v3/@claude-flow/cli/src/services/policy-runtime.ts`, `mcp-client.ts`, `v3/@claude-flow/security/src/policy/evaluator.ts`, tests
**Estimated scope:** M

---

### Task 17: CI required check

**Description:** A CI job that runs record validation and the phase-gate check on every pull request, wired as a required status check with branch protection.

**Owner for the repo setting (D4):** Sairam enables branch protection on the day this task merges, not before.

**Why this matters:** This is the only tier nobody can bypass — not an agent, not `--no-verify`, not a transport switch. Every rule we genuinely care about must be expressed here, because tiers 1 and 2 are fast feedback and this one is the contract. Without branch protection turned on, this job is advisory too.

**Acceptance criteria:**
- [ ] PR with an invalid record set fails CI
- [ ] PR with code changes but no citing task record fails CI
- [ ] Job is a required status check on the default branch

**Verification:**
- [ ] Open a deliberately invalid PR, confirm it is blocked from merging
- [ ] Open a valid PR, confirm it passes
- [ ] Confirm branch protection is actually enabled, not just the workflow present

**Dependencies:** T15, T16
**Files likely touched:** `.github/workflows/sdlc-gate.yml`, repo settings
**Estimated scope:** S

---

### Checkpoint: Phase 4
- [ ] The same mandatory step cannot be skipped from Claude Code, Cursor or Codex
- [ ] An invalid change cannot be merged
- [ ] Denials carry actionable messages
- [ ] **Human review before proceeding**

---

## Phase 5: Test-gated done (vertical slice E)

### Task 18: Done criteria on the task record

**Description:** Extend the task schema so each task declares its own bar: which test layers apply, coverage threshold, and any acceptance checks. Different tasks get different bars.

**Why this matters:** A config change does not need an end-to-end test and a checkout flow does. A single global bar is either too weak to be meaningful or too heavy to be tolerated, and teams route around the second. Declaring the bar per task is also what makes the later gate objective rather than a judgement call at review time.

**Acceptance criteria:**
- [ ] Task records declare applicable test layers and thresholds
- [ ] A sensible default is inferred at decomposition time and is editable
- [ ] Schema validates the shape

**Verification:**
- [ ] Unit tests over the extended schema
- [ ] Manual: confirm decomposition produces reasonable defaults

**Dependencies:** T3, T6
**Files likely touched:** record schemas, decomposition agent, tests
**Estimated scope:** S

---

### Task 19: Test runner and derived status

**Description:** The engine runs the project's own test command, parses the result, and writes the outcome into the record. Status is derived from test results, never asserted by the agent. Reuse `coverageGaps()` from `v3/@claude-flow/cli/src/ruvector/coverage-router.ts:445` for the coverage side.

**Why this matters:** This is the mechanism behind requirement 8 and the reason it works. An agent that can set its own done field will eventually set it while the suite is red — not from malice but because it believes it succeeded. Deriving status from evidence removes the question. The model is borrowed from rtmx, which derives requirement status from linked test results; the coverage parser already exists and works on real istanbul and lcov output.

**Acceptance criteria:**
- [ ] Engine runs the configured test command and captures the result
- [ ] Coverage is parsed and compared against the task's threshold
- [ ] `Done` is unreachable while tests are red or coverage is below threshold
- [ ] The agent has no API to set `Done` directly

**Verification:**
- [ ] Test: red suite blocks the transition
- [ ] Test: green suite below coverage threshold blocks the transition
- [ ] Test: green and above threshold permits it
- [ ] Manual: confirm there is no bypass path

**Dependencies:** T15, T18
**Files likely touched:** `v3/@claude-flow/cli/src/ruvector/coverage-router.ts`, state machine, new runner, tests
**Estimated scope:** M

---

### Task 20: Wrap the red-to-green repair loop

**Description:** Wrap `plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs` so a red result triggers bounded repair attempts, and exhaustion routes the task to `Blocked`.

**Why this matters:** This is the one genuinely good QA component already in the fork — it runs the test command, refuses to act if already green, spawns a budget-capped headless fixer, re-runs, and gates on exit code. Wrapping rather than rewriting saves a week. Bounding the retries is the important addition: without a limit, a task that cannot be fixed will consume budget indefinitely with nobody watching.

**Acceptance criteria:**
- [ ] A red task triggers repair automatically within the workflow
- [ ] Retry count is bounded and configurable
- [ ] The same failure twice in a row stops rather than trying a third time
- [ ] Exhaustion moves the task to `Blocked` with the failing output attached

**Verification:**
- [ ] Test with a deliberately broken change: repair runs, then gives up cleanly
- [ ] Test with a trivially fixable break: repair succeeds and the task advances
- [ ] Confirm budget cap is honoured

**Dependencies:** T19
**Files likely touched:** new wrapper, state machine, tests
**Estimated scope:** M

---

### Checkpoint: Phase 5
- [ ] A task cannot reach `Done` with a red suite
- [ ] Repair runs automatically and gives up safely
- [ ] **Human review before proceeding**

---

## Phase 6: Plain English (vertical slice F)

### Task 21: ASD-STE100 validator in record validation

**Description:** A validator on the human-facing fields of each record, run alongside schema validation. Default mode enforces structural rules; strict mode adds controlled vocabulary for artifacts that leave the team.

**Why this matters:** The point of requirement 4 is review speed. If a reviewer has to decode the AI's prose, the workflow has moved the bottleneck rather than removed it. Placing the check inside validation rather than in a prompt is the only way it holds across tools — the same reasoning as AD-1. Scope discipline matters: applying this to code comments and commit messages would make it annoying for no benefit, which is the main way this requirement fails.

**Acceptance criteria:**
- [ ] Checks sentence length, active voice, one instruction per sentence, undefined jargon, hedging words
- [ ] Applies to record summaries and reports only, not code comments or commit messages
- [ ] Failing readability blocks the record transition
- [ ] Strict mode is opt-in per record

**Verification:**
- [ ] Unit tests for each rule, pass and fail cases
- [ ] Manual: write a deliberately dense summary, confirm rejection with a useful message
- [ ] Confirm a normal code commit is unaffected

**Dependencies:** T3
**Files likely touched:** `v3/@claude-flow/docops/src/validators/readability.ts`, tests
**Estimated scope:** M

---

## Phase 7: Tool adapters (vertical slice G)

### Task 22: Cursor and generic MCP adapters

**Description:** New generators following the existing `(options) => Promise<string>` contract in `v3/@claude-flow/codex/src/generators/index.ts`. Emit a Cursor rules file and a generic `AGENTS.md`, and register both in the initialiser's emitted file list.

**Why this matters:** Requirement 1 says any tool. The fork has zero references to Cursor anywhere — this is a genuine gap, not a configuration. Generating all rules files from one source is what prevents the four targets from drifting apart, and drift between tools is exactly the failure this architecture exists to prevent. These files are advisory by design; none of our guarantees depend on them, they just make the workflow usable.

**Acceptance criteria:**
- [ ] Cursor rules file and generic `AGENTS.md` are generated from the same source as `CLAUDE.md`
- [ ] All targets describe the same workflow, verified by a test comparing generated content
- [ ] `init` emits them

**Verification:**
- [ ] Snapshot tests over each generated file
- [ ] Test asserting the workflow description is identical across targets
- [ ] Manual: drive one task from Cursor using only the generated file

**Dependencies:** T16
**Files likely touched:** `v3/@claude-flow/codex/src/generators/`, `initializer.ts`, tests
**Estimated scope:** M

---

## Phase 8: Backfill (vertical slice H)

### Task 23: Mechanical pass over the existing codebase

**Description:** Derive structure, dependencies, entry points and existing test coverage per area from the Graphify graph. No model calls.

**First area (D3):** `v3/@claude-flow/cli/src/ruvector/`. Backfill runs one area at a time (D1), never as a wholesale pass.

**Why this matters:** Deterministic, free, and it grounds the inferred pass that follows. Graphify already reports a token cost of zero for extraction, so this is effectively free to re-run whenever the graph refreshes. Doing this before any inference means the agent reasons about real structure rather than guessing it.

**Acceptance criteria:**
- [ ] Per-area summary of modules, dependencies, entry points and test presence
- [ ] Runs with no model calls and no token cost
- [ ] Output is reproducible from a given commit

**Verification:**
- [ ] Run against two areas, spot-check accuracy against the code
- [ ] Confirm zero token spend

**Dependencies:** T1
**Files likely touched:** new backfill module, tests
**Estimated scope:** M

---

### Task 24: Inferred requirement extraction

**Description:** An agent reads an area's code, git history and existing docs, then proposes requirement and decision records. Every record is written with provenance marked inferred and a confidence score. A human confirms before it counts as authoritative.

**Why this matters:** This is the only part of the mapping problem nobody sells, and it is where our differentiation sits — Graphify gives structure, never intent. The provenance rule is load-bearing: if a guessed requirement is indistinguishable from an authored one, the substrate stops being trustworthy and every downstream gate inherits the doubt. Graphify's own extracted-versus-inferred tagging is the model to mirror.

**Acceptance criteria:**
- [ ] Produces requirement and decision records for a given area
- [ ] Every record carries inferred provenance and a confidence score
- [ ] An unconfirmed record cannot satisfy a phase gate
- [ ] A confirmation command promotes a record to authoritative

**Verification:**
- [ ] Run against one well-understood area, manually assess whether the requirements are recognisable
- [ ] Test: an unconfirmed record does not satisfy a gate
- [ ] Confirm records validate

**Dependencies:** T16, T23
**Files likely touched:** agent definition, record writer, state machine, tests
**Estimated scope:** M

---

## Phase 9: Autonomy (vertical slice I)

### Task 25: The autonomy loop

**Description:** A CLI command that repeatedly picks the next task whose preconditions are met, runs its phase, records the outcome, and repeats until no transition is available. All state lives in records, so the loop is restartable.

**Why this matters:** Requirement 7. Making this a loop over the state machine rather than a long-lived agent session is what makes it predictable and restartable — it survives crashes, budget limits and a closed laptop, and can resume on a different machine in a different tool. Running it as a CLI command rather than a tool-specific hook is what keeps it tool-neutral; the inherited autopilot is Claude Code-only, never installed, and returns success from its own check so it could not block anything.

**Acceptance criteria:**
- [ ] Picks and executes available transitions until none remain
- [ ] Stops on: no available transition, repeated failure, a gate needing a human
- [ ] Reports why it stopped and what would unblock it
- [ ] Resumes correctly after being killed mid-run

**Verification:**
- [ ] Test: runs a small task set to completion unattended
- [ ] Test: kill mid-run and resume, confirm no duplicate or lost work
- [ ] Test: a blocked task stops the loop with a clear reason

**Dependencies:** T19, T20
**Files likely touched:** `v3/@claude-flow/cli/src/commands/run.ts`, tests
**Estimated scope:** M

---

### Task 26: Spend backstop

**Description:** A configurable total spend ceiling for an unattended run, checked between transitions. Generous by default.

**Why this matters:** The team has decided against fixed retry and spend limits, which is reasonable while somebody is watching. It is not safe for the first overnight run, where a repeating failure can consume budget with nobody present. This is a backstop, not a policy — it should almost never fire, and when it does it has prevented a bad night.

**Acceptance criteria:**
- [ ] A total spend ceiling can be set per run
- [ ] The loop stops cleanly when reached and reports spend against quote
- [ ] Default is generous enough not to interfere with normal work

**Verification:**
- [ ] Test with a low ceiling: loop stops at the limit and records state
- [ ] Confirm a resumed run does not double-count spend

**Dependencies:** T25
**Files likely touched:** autonomy loop, budget service, tests
**Estimated scope:** S

---

### Checkpoint: Complete
- [ ] All eight requirements demonstrably met
- [ ] Workflow drives a real feature end to end in at least two different AI tools
- [ ] Quote, variance, gates, QA and autonomy all working together
- [ ] **Final review**

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Inherited components are untested — CI carries 121 known-failing test files on a ratchet, coverage thresholds commented out | High | Verify each component at the point we adopt it. Do not assume a green run means working code. |
| Early quotes are wide and a bad number damages trust | High | Always quote ranges with confidence. Publish variance from task one. Never a point estimate. |
| Gates become friction and people route around them | High | Per-task done criteria rather than one global bar. Tune preconditions on real usage. |
| Pilot is the fork itself, so failures are ambiguous between our bug and inherited breakage | Medium | Assume inherited breakage first. Fix the suite in each area before trusting a green run there. |
| DocOps upstream is unmaintained | Medium | Forked, not depended on. We own the code. |
| Graphify graph goes stale and agents reason about moved code | Medium | Refresh in CI, fail the build when the recorded commit drifts from `HEAD`. |
| Backfill balloons across 3,667 files | Medium | Backfill per area on demand. Never a wholesale pass. |
| Graphify is one project's output format and could change | Low | Pin the version. Access through one adapter module, not scattered call sites. |

---

## Parallelisation

**Safe to run in parallel:**
- T7 (corpus) and T12 (pricing fixes) — no shared files, both unblock Phase 2
- T21 (plain English) and T22 (adapters) — independent of each other
- T23 (mechanical backfill) alongside Phase 4 work

**Must be sequential:**
- T2 → T3 → T4: schema changes ripple into everything
- T15 → T16 → T17: the gate tiers must agree on the same state machine
- T19 → T20: repair depends on the runner

**Needs coordination:**
- T11 defines the quote contract consumed by later reporting. Fix the output shape before anything reads it.

---

## Decisions

All five open questions were approved on 2026-09-18. Nothing is blocked. The reasons are kept here so we remember why we chose each one.

### D1. We backfill one area at a time

Backfill means writing requirement records for code that already exists.

**Decision:** write records only for the area we are working on. Repeat this each time we start a new area. We do not write records for all 3,667 files at the start.

**Reason:** writing records for all files will take several weeks. Most of those records nobody will read.

**Applies to:** T23, T24

### D2. One unattended run has a high spending limit

**Decision:** there is no fixed retry limit. The AI keeps asking questions until the requirement is clear. But we set a high total spending limit before the first overnight run.

**Reason:** no limit is correct when a person is watching the run. At night, a task that fails again and again can spend money with nobody watching. The limit is a backstop. It should almost never fire.

**Applies to:** T26

### D3. First backfill area is the ruvector folder

**Decision:** start with `v3/@claude-flow/cli/src/ruvector/`.

**Reason:** we will change this folder anyway in Phase 2. It holds the price table, the trajectory log, the complexity scorer and the coverage parser. Tasks T7, T9, T10 and T12 all touch it. Backfilling the code we are about to read gives us the benefit at once. It also tests the backfill against code we know well.

**Applies to:** T23

### D4. Sairam turns on branch protection, on the day T17 merges

Branch protection stops anyone from merging a pull request that fails the checks.

**Decision:** Sairam turns it on, because he owns the fork. He does this on the same day T17 merges, not before.

**Reason:** if we turn it on early, the gate will block normal work before the gate is ready. If we turn it on late, we will believe we are protected when we are not. Turning it on with T17 avoids both problems.

**Applies to:** T17

### D5. The calibration set has a 50 dollar limit

Task T8 runs 15 to 20 real tasks. We record the cost of each one. This becomes our training data.

**Decision:** about 50 US dollars for the whole set. This is roughly 2 to 3 dollars for each task.

**Reason:** this is a one-time cost and it creates an asset we keep. Every later quote uses this data. Without it, our first quotes will be very wide. If we spend less than half the limit, we add more tasks instead of stopping early.

**Applies to:** T8
