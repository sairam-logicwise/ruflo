---
title: Bare-minimum frontmatter philosophy
status: accepted
coverage: required
date: 2026-04-22
supersedes: []
related: [ADR-0005, ADR-0010]
tags: [schema, philosophy]
---

# Bare-minimum frontmatter philosophy

## Context

Over-specified frontmatter rots fast: fields go unfilled, authors skip the doc because the ceremony feels heavy, and LLMs waste context on fields that are rarely queried. Under-specified frontmatter forces structural information into body prose where agents cannot efficiently query it.

## Decision

A field enters the source frontmatter only if it passes all three of:

1. **Inevitability** — near-certain to be used within the first two weeks of real adoption.
2. **Structurality** — its absence would push information into body prose where an LLM cannot query without a body load.
3. **Schema stability** — has a fixed shape or a small enum; if it varies per project, it belongs in `docops.yaml` not the schema.

Computed/derived fields (reverse edges, resolved references, staleness, summaries) do not count toward the minimum — they live in the index layer (see ADR-0005).

## The final source-frontmatter shape

**Context** (3 fields):
- `title`
- `type` (project-configured enum)
- `supersedes` (array, default `[]`)

**ADR** (7 fields):
- `title`
- `status` (`draft | accepted | superseded`)
- `coverage` (`required | not-needed`)
- `date` (pinned at acceptance)
- `supersedes` (array, default `[]`)
- `related` (array, default `[]`)
- `tags` (array, default `[]`)

**Task** (6 fields):
- `title`
- `status` (`backlog | active | blocked | done`)
- `priority` (`p0 | p1 | p2`, default `p2`)
- `assignee` (string, default `unassigned`)
- `requires` (array, must contain ≥1 ADR or CTX ref — see ADR-0004)
- `depends_on` (array, default `[]`)

## Rationale

Fields added under this rule were each tested against the three criteria. Fields rejected: `author` (git blame covers it), `created_at` (git has it), `tags` on CTX (rarely queried at that level), `acceptance` as structured field on tasks (belongs in body until programmatic checking is needed), `summary` on any doc (first paragraph is good enough until scale forces it).

Fields that almost made it but were held: `subtasks`, `linked_prs`, `effort_estimate`. Each fails inevitability or belongs to a future phase.

## Consequences

- Validators are small and stable.
- Agents can parse frontmatter deterministically.
- Adding a field is a schema-change event requiring an ADR (not a casual PR).
- Projects that need a field DocOps lacks should open an issue; local drift via unofficial fields is tolerated only in the body, not frontmatter.
