# Vendored from DocOps (T2, agentic SDLC plan — tasks/plan.md)

**Source:** https://github.com/logicwind/DocOps
**Pinned commit:** `81c151e7b576b088d7cf6c4247ff8d02e1be3c80` (`main`, 2026-05-09)
**License:** MIT — Copyright (c) 2026 Logicwind Technologies Pvt Ltd. Full text in [`LICENSE`](./LICENSE), unmodified.

## What this is

DocOps is a **Go CLI tool** (its own `go.mod`, `cmd/`, `internal/` layout — not a
JS/TS library). The plan's original framing ("new `v3/@claude-flow/docops/`
package", "no runtime npm dependency") assumed a JS/TS vendoring shape; that
assumption didn't hold once the actual upstream was inspected.

**Decision (confirmed with the repo owner, 2026-09-21):** vendor a
reference-only copy — no Go build, no runtime execution, nothing shells out
to it. `vendor/` below exists so T3 (record schemas) can read and adapt the
real design rather than working from a secondhand description. The three
record types (`ruflo req`/`decision`/`task`) and their validator get
reimplemented natively in TypeScript.

## What's vendored, and why

| Path | What it is | Why it's here |
|---|---|---|
| `vendor/schema/types.go` | The `Context`/`ADR`/`Task` struct definitions, enums, and the `CTX-`/`ADR-`/`TP-` ID scheme | The actual record shape to adapt for T3 |
| `vendor/schema/validate.go` | Per-type field validation, including the citation rule (`requires` must contain ≥1 CTX or ADR) | The exact rule T5's git-hook contract and T4's CLI refusal message need to match in spirit |
| `vendor/schema/jsonschema.go` | Generates JSON Schema from the Go structs, for editor autocomplete | Reference for T3's "generates a JSON Schema for editor validation" acceptance criterion |
| `vendor/validator/validator.go` | Cross-document edge checks (superseded-reference warnings, `related`/`supersedes` handling) | Reference for T15 (state machine) and T24 (backfill) — this is where "referenced_by" / coverage logic lives upstream |
| `vendor/docs-examples/ADR-0002/0003/0004-*.md` | The three upstream ADRs that motivated the schema (bare-minimum frontmatter, filename-as-ID, the citation rule itself) | Primary-source rationale, not just code — useful when T3's design departs from upstream and needs to explain why |
| `vendor/docs-examples/CTX-001-docops-vision.md` | One real example of the CTX doc type in practice | A worked example beats a schema diagram |
| `LICENSE` | Verbatim MIT license | Required to vendor at all |

**Stripped (not vendored):** everything else — `cmd/` (CLI plumbing:
`init`, `serve`/HTML viewer, `audit`, `amender`, `upgrader`, `updatecheck`,
`scaffold`, release tooling), `internal/htmlviewer`, `internal/nextsteps`,
`internal/state`, `internal/index`, `internal/loader`, `internal/config`,
`templates/` (Homebrew/Scoop/slash-command scaffolding), all `_test.go`
files, `CHANGELOG.md`, `.goreleaser.yml`, and DocOps's own self-hosted
`docs/` beyond the four example files above. None of it is design reference
for the schema/citation-rule work T3 needs; it's Go-specific CLI plumbing we
are not running.

## Correction to the plan's stated rationale

`tasks/HANDOVER.md` §7 says DocOps has been "untouched since May." That's
not accurate as of this vendoring: the repo has an active `dev` branch and a
`release/v0.3.0` branch with commits after May, and `VERSION` reads `0.7.0`
(ahead of the last tagged release, `v0.6.0`, 2026-04-30) — there's
unreleased work in progress. This doesn't change the "fork, don't depend"
decision (AD-3) — a single-maintainer, 1-star project is still a liability
as a *live* dependency regardless of how active it is — but the stated
justification was wrong and is corrected here for the record.

## Updating this vendored copy

There is no automation for this — it's a point-in-time reference snapshot,
not a tracked dependency. If a future task needs a newer look at upstream,
re-clone `https://github.com/logicwind/DocOps` at the desired ref, diff
against the files listed above, and update the pinned commit hash in this
file.
