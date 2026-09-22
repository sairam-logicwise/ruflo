---
title: DocOps — Vision and North Star
type: brief
supersedes: []
---

# DocOps — Vision and North Star

## What DocOps is

DocOps is a **typed project-state substrate** for LLM-first software development. It lives inside `docs/` in a git repository and gives coding agents three things they need to plan and execute well:

1. **Good context** — stakeholder inputs, decisions, and tasks stored as machine-readable markdown with YAML frontmatter.
2. **Traceability** — typed relationship edges between documents (supersedes, related, requires) with computed reverse edges.
3. **Gap and coverage detection** — both structural (no task exists for an accepted ADR) and semantic (an LLM judges whether existing tasks actually cover a decision's intent).

That is the entire product. DocOps does not orchestrate phases, does not assign personas to agents, does not generate code, does not run execution harnesses. It is the substrate; the LLM's native plan-and-execute capability does the work.

## Who it is for

Small-to-medium software teams that work with LLMs (Claude Code, Cursor, Aider, Codex, etc.) as first-class collaborators and want:

- Project state that agents can read without impedance.
- Alignment between tasks and the stakeholder intent / decisions that justify them.
- A way to spot gaps before they rot into tech debt or drift.
- Documentation that travels with the code in git rather than siloed in Jira/Linear.

## Three doc types

- **Context (`docs/context/`)** — stakeholder inputs: PRDs, design docs, memos, research, interview notes. Heterogeneous shapes, typed by the `type:` field. These are the *why*.
- **Decisions (`docs/decisions/`)** — ADRs. The *how we chose* layer. Typed by status (draft/accepted/superseded) and implementation (computed).
- **Tasks (`docs/tasks/`)** — units of work. Every task must cite ≥1 decision or context document. That citation is the alignment contract.

## The alignment contract (the wedge)

Every task's `requires:` frontmatter must contain at least one valid ADR or CTX reference. The validator refuses tasks without it. This is the single invariant that prevents drift between "what we're building" and "what we said we'd build."

No other tool in the space (Backlog.md, Markplane, GSD, BMAD, Spec Kit, Kiro, Linear) enforces this. It is DocOps' strongest differentiator.

## How agents use DocOps

1. Land in the repo.
2. Read `AGENTS.md` (auto-emitted, a universal standard).
3. Run `docops audit` to see gaps and `docops next` to pick work.
4. Read referenced ADRs and CTX before coding (forced by citation rule).
5. Plan and execute using native agent capabilities — DocOps does not prescribe process.
6. On completion, update status via CLI; schemas stay valid.

## What success looks like

An agent dropping cold into a DocOps-enabled repo can:

- Understand the project's stakeholder intent in under one minute (STATE.md + top CTX).
- Pick the next justifiable task without asking the human for context.
- Produce a change that respects every decision its task cites.
- Detect, after its own work, whether new gaps appeared.

If that works, DocOps has done its job.
