/**
 * T17 (agentic SDLC plan) — task-citation-check, pure logic. Matching this
 * directory's own convention of testing a script's .mjs sibling in
 * isolation (see pre-commit-hook.test.mjs).
 */

import { describe, expect, it } from 'vitest';
import { checkTaskCitation } from '../ci/task-citation-check-lib.mjs';

describe('checkTaskCitation', () => {
  it('passes a docs-only change with no task record involved', () => {
    const result = checkTaskCitation(['docs/requirements/REQ-001-x.md', 'docs/decisions/DEC-001-y.md']);
    expect(result.ok).toBe(true);
  });

  it('passes a code change accompanied by a docs/tasks/ record change', () => {
    const result = checkTaskCitation(['src/foo.ts', 'docs/tasks/TASK-001-x.md']);
    expect(result.ok).toBe(true);
  });

  it('fails a code change with no docs/tasks/ record change at all', () => {
    const result = checkTaskCitation(['src/foo.ts', 'README.md']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.nonDocsChanges).toEqual(['src/foo.ts', 'README.md']);
    }
  });

  it('a docs/requirements/ or docs/decisions/ change alone does not count as a "task record" change', () => {
    const result = checkTaskCitation(['src/foo.ts', 'docs/requirements/REQ-001-x.md']);
    expect(result.ok).toBe(false);
  });

  it('passes an empty diff (nothing changed)', () => {
    expect(checkTaskCitation([]).ok).toBe(true);
  });

  it('a change confined to tasks/plan.md (the human checklist, NOT docs/tasks/) still counts as needing a record — no special-casing', () => {
    const result = checkTaskCitation(['tasks/plan.md', 'v3/@claude-flow/cli/src/commands/run.ts']);
    expect(result.ok).toBe(false);
  });
});
