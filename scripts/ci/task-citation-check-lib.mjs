/**
 * task-citation-check-lib.mjs — T17, agentic SDLC plan. Pure logic behind
 * the second half of the CI job's phase-gate: "PR with code changes but no
 * citing task record fails CI."
 *
 * The task schema (T3) has no file-path field mapping a task to the source
 * files it covers, so this cannot check "does a task's citations genuinely
 * COVER these specific files" — that's not a claim the current schema can
 * support. What it CAN check, mechanically: does a PR that touches
 * anything outside `docs/` also touch/add at least one file under
 * `docs/tasks/`, i.e. did SOME task record ride along in the same PR.
 * Deliberately mechanical, not semantic — same honesty this plan already
 * applies elsewhere (T9's token-overlap grounding, T21's readability
 * heuristics) rather than pretending to verify something the data doesn't
 * support.
 *
 * @module ci/task-citation-check-lib
 */

/**
 * @param {string[]} changedPaths - repo-relative paths changed in the PR (any diff-filter)
 * @returns {{ ok: true, reason: string } | { ok: false, reason: string, nonDocsChanges: string[] }}
 */
export function checkTaskCitation(changedPaths) {
  const nonDocsChanges = changedPaths.filter((p) => !p.startsWith('docs/'));
  if (nonDocsChanges.length === 0) {
    return { ok: true, reason: 'docs-only change — no task record required' };
  }
  const hasTaskRecordChange = changedPaths.some((p) => p.startsWith('docs/tasks/'));
  if (hasTaskRecordChange) {
    return { ok: true, reason: 'a docs/tasks/ record change rode along with the code change' };
  }
  return {
    ok: false,
    reason: `${nonDocsChanges.length} non-docs file(s) changed with no docs/tasks/ record change in the same PR`,
    nonDocsChanges,
  };
}
