/**
 * pre-commit-lib.mjs — testable core of the pre-commit citation-contract
 * hook (T5, agentic SDLC plan). Pure w.r.t. I/O: takes the staged file list,
 * a content reader, and the loaded docops module as arguments, so tests
 * don't need a real git repo or a built docops package.
 *
 * @module hooks/pre-commit-lib
 */

export const RECORD_PATH_PATTERN = /^docs\/(requirements|decisions|tasks)\/.*\.md$/;

/**
 * @param {string[]} changedPaths - repo-relative paths of staged files (any diff-filter)
 * @param {(path: string) => string} readStagedContent - returns the STAGED blob content for a record path
 * @param {{ validateRecordFile: (raw: string) => { success: boolean; error?: Error } } | null} docops
 *   - the loaded @claude-flow/docops module, or null if it isn't built
 * @returns {{ status: 'ok' | 'blocked' | 'skipped-not-built'; failures: Array<{ path: string; message: string }> }}
 */
export function evaluateStagedRecords(changedPaths, readStagedContent, docops) {
  const recordPaths = changedPaths.filter((p) => RECORD_PATH_PATTERN.test(p));

  if (recordPaths.length === 0) {
    return { status: 'ok', failures: [] };
  }

  if (!docops) {
    return { status: 'skipped-not-built', failures: [] };
  }

  const failures = [];
  for (const path of recordPaths) {
    let raw;
    try {
      raw = readStagedContent(path);
    } catch {
      continue; // deleted-then-restaged race or similar — nothing to validate
    }
    const result = docops.validateRecordFile(raw);
    if (!result.success) {
      failures.push({ path, message: formatError(result.error) });
    }
  }

  return { status: failures.length > 0 ? 'blocked' : 'ok', failures };
}

export function formatError(error) {
  const issues = error && error.issues;
  if (Array.isArray(issues)) {
    return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  }
  return error.message;
}
