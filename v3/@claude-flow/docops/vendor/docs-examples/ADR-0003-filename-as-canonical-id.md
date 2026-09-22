---
title: Filename is the canonical document ID
status: accepted
coverage: required
date: 2026-04-22
supersedes: []
related: [ADR-0001]
tags: [schema, identity]
---

# Filename is the canonical document ID

## Context

Many doc systems carry an `id:` field in frontmatter separate from the filename. This creates two sources of truth and a rename-drift problem: the file moves, the ID stays, references break or are confusing.

## Decision

The document ID is derived from the filename by stripping the `.md` extension and taking the leading code-slug portion. For example:

- `docs/decisions/ADR-0020-plugin-architecture.md` → ID `ADR-0020`
- `docs/context/CTX-003-billing-prd.md` → ID `CTX-003`
- `docs/tasks/TP-014-add-zod-validator.md` → ID `TP-014`

No `id:` field in frontmatter. References in `requires`, `supersedes`, `related`, `depends_on` use the filename-derived ID.

## Rationale

- Single source of truth. Renaming a file is a rename of its identity, and the linter catches broken references immediately.
- Agents and humans use the same name conversationally ("ADR-0020") as in the data.
- Keeps frontmatter smaller (one fewer field).
- File-system tooling (grep, find, git log) works natively on the ID.

## Consequences

- Renames must be done deliberately; the validator will surface broken references as errors.
- ID format is enforced: `ADR-NNNN`, `CTX-NNN`, `TP-NNN` (prefix + dash + zero-padded integer). The `docops new` command allocates the next monotonic integer atomically.
- Archives or historical renames must use `supersedes` chains, not silent renames.
