/**
 * T5 (agentic SDLC plan) — pre-commit citation-contract hook, pure logic.
 * Real end-to-end verification (real git repo, real docops, real hook
 * invocation, timed) is manual — see tasks/plan.md's Task 5 note. This
 * covers the decision logic in isolation, matching this directory's own
 * convention (ci-test-ratchet.test.mjs tests its .mjs sibling the same way).
 */

import { describe, expect, it } from 'vitest';
import { evaluateStagedRecords, RECORD_PATH_PATTERN } from '../hooks/pre-commit-lib.mjs';

function fakeDocops(validIds) {
  return {
    validateRecordFile(raw) {
      const isValid = validIds.some((id) => raw.includes(id));
      return isValid ? { success: true } : { success: false, error: new Error('boom: invalid') };
    },
  };
}

describe('RECORD_PATH_PATTERN', () => {
  it('matches requirement/decision/task record paths', () => {
    expect(RECORD_PATH_PATTERN.test('docs/requirements/REQ-001-x.md')).toBe(true);
    expect(RECORD_PATH_PATTERN.test('docs/decisions/DEC-001-x.md')).toBe(true);
    expect(RECORD_PATH_PATTERN.test('docs/tasks/TASK-001-x.md')).toBe(true);
  });

  it('does not match unrelated docs or code paths', () => {
    expect(RECORD_PATH_PATTERN.test('docs/USERGUIDE.md')).toBe(false);
    expect(RECORD_PATH_PATTERN.test('src/index.ts')).toBe(false);
    expect(RECORD_PATH_PATTERN.test('.gitignore')).toBe(false);
  });
});

describe('evaluateStagedRecords', () => {
  it('is a fast no-op when no staged files are records — never loads docops', () => {
    const result = evaluateStagedRecords(['.gitignore', 'src/index.ts'], () => {
      throw new Error('should not be called');
    }, null);
    expect(result).toEqual({ status: 'ok', failures: [] });
  });

  it('allows the commit (soft-fail) when docops is not built, but records changed', () => {
    const result = evaluateStagedRecords(['docs/requirements/REQ-001-x.md'], () => 'irrelevant', null);
    expect(result.status).toBe('skipped-not-built');
    expect(result.failures).toEqual([]);
  });

  it('passes when every changed record validates', () => {
    const docops = fakeDocops(['REQ-001']);
    const result = evaluateStagedRecords(
      ['docs/requirements/REQ-001-x.md', 'src/unrelated.ts'],
      () => 'id: REQ-001',
      docops,
    );
    expect(result.status).toBe('ok');
  });

  it('blocks and names the file when a changed record fails validation', () => {
    const docops = fakeDocops(['REQ-999']); // REQ-001 won't match
    const result = evaluateStagedRecords(
      ['docs/requirements/REQ-001-x.md'],
      () => 'id: REQ-001',
      docops,
    );
    expect(result.status).toBe('blocked');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].path).toBe('docs/requirements/REQ-001-x.md');
    expect(result.failures[0].message).toMatch(/boom/);
  });

  it('checks only the changed records, ignoring non-record files in the same commit', () => {
    const docops = fakeDocops(['REQ-001']);
    const result = evaluateStagedRecords(
      ['docs/requirements/REQ-001-x.md', 'README.md', 'src/index.ts'],
      (path) => {
        if (path !== 'docs/requirements/REQ-001-x.md') throw new Error('should not read non-record files');
        return 'id: REQ-001';
      },
      docops,
    );
    expect(result.status).toBe('ok');
  });

  it('skips a path whose staged content cannot be read (e.g. a delete/restage race) rather than crashing', () => {
    const docops = fakeDocops(['REQ-001']);
    const result = evaluateStagedRecords(
      ['docs/requirements/REQ-001-x.md'],
      () => { throw new Error('not found'); },
      docops,
    );
    expect(result.status).toBe('ok');
    expect(result.failures).toEqual([]);
  });
});
