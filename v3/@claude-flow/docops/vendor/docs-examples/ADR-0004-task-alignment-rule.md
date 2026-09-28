---
title: Tasks must cite ≥1 ADR or CTX — the alignment contract
status: accepted
coverage: required
date: 2026-04-22
supersedes: []
related: [ADR-0001, ADR-0008]
tags: [schema, invariant, wedge]
---

# Tasks must cite ≥1 ADR or CTX — the alignment contract

## Context

Existing task systems (Jira, Linear, Backlog.md, GSD plans, BMAD stories) permit tasks to be created without a structural link to the decision or stakeholder intent they advance. In practice this means work drifts from its original justification; no tool catches it.

## Decision

A task's `requires:` frontmatter field MUST contain at least one valid reference to an ADR or CTX. The linter (`docops validate`) rejects any task with an empty `requires:` array. The CLI (`docops new task`) refuses to create one without at least one citation specified.

Valid references:
- An ADR in `docs/decisions/` with a lifecycle state other than `superseded`.
- A CTX in `docs/context/` not superseded by another CTX.

References to superseded documents emit warnings (configurable as errors in `docops.yaml`).

## Rationale

- This is DocOps' core differentiator. No competitor enforces it structurally.
- Forces every piece of work to answer "why are we doing this?" at creation time, not post-hoc.
- Makes coverage detection possible (see ADR-0008): a decision's implementation status is computed from the tasks citing it.
- Creates the reverse edges (`referenced_by`) that power gap detection.

## Consequences

- Ad-hoc, stakeholder-less work is not representable as a DocOps task. Projects must create a CTX (even a one-line memo) or an ADR first. This is intentional friction.
- Bug-fix and chore tasks must still cite something. Acceptable patterns: cite the CTX that describes the product area, or the ADR whose invariant the bug violates, or an internal CTX like `CTX-eng-hygiene`.
- Tasks should not cite superseded docs; the linter surfaces this and `docops audit` flags it.
- The citation rule applies only to tasks. ADRs and CTX do not have to cite anything (though related/supersedes links are encouraged).
