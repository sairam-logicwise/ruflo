/**
 * records-io.ts — formatValidationError. Regression test for a real bug
 * found only by running the real compiled CLI (T21): ReadabilityError
 * carries its own `issues` array shaped `{rule, sentence, message}`, and
 * the old ZodError duck-type check (`Array.isArray(error.issues)` alone)
 * matched it too, then crashed on the missing `path` field.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatValidationError, checkCitationAcceptance } from '../src/commands/records-io.js';
import { ReadabilityError, type Task } from '@claude-flow/docops';
import type { CommandContext } from '../src/types.js';

describe('formatValidationError', () => {
  it('formats a real ZodError-shaped error using path + message per issue', () => {
    const zodLike = Object.assign(new Error('invalid'), {
      issues: [
        { path: ['status'], message: 'Invalid enum value' },
        { path: ['citations', 0], message: 'must cite a requirement or decision' },
      ],
    });
    const formatted = formatValidationError(zodLike);
    expect(formatted).toBe('status: Invalid enum value; citations.0: must cite a requirement or decision');
  });

  it('does not crash on a ReadabilityError, and returns its own useful message', () => {
    const error = new ReadabilityError([
      { rule: 'hedging', sentence: 'This might work.', message: 'hedging word "might"' },
    ]);
    expect(() => formatValidationError(error)).not.toThrow();
    const formatted = formatValidationError(error);
    expect(formatted).toContain('hedging word "might"');
  });

  it('falls back to .message for a plain error with no issues array at all', () => {
    expect(formatValidationError(new Error('something else went wrong'))).toBe('something else went wrong');
  });

  it('falls back to .message for an error whose "issues" array exists but is not Zod-shaped', () => {
    const weird = Object.assign(new Error('fallback'), { issues: ['just a string', 42] });
    expect(formatValidationError(weird)).toBe('fallback');
  });
});

/**
 * T16 — the real evidence-gathering behind state-machine.ts's citation-
 * acceptance precondition. docops has no filesystem access (AD-1), so this
 * is the one place that actually reads a task's cited REQ/DEC records and
 * checks their status.
 */
describe('checkCitationAcceptance', () => {
  let tmp: string;
  let ctx: CommandContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'citation-check-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    mkdirSync(join(tmp, 'docs', 'requirements'), { recursive: true });
    mkdirSync(join(tmp, 'docs', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeRecord(dir: 'requirements' | 'decisions', filename: string, status: string): void {
    writeFileSync(
      join(tmp, 'docs', dir, filename),
      `---\nid: ${filename.split('-').slice(0, 2).join('-')}\nstatus: ${status}\n---\n\n# x\n`,
    );
  }

  function taskWith(citations: string[]): Task {
    return { citations } as Task;
  }

  it('is fully accepted when every REQ/DEC citation is status: accepted', () => {
    writeRecord('requirements', 'REQ-001-x.md', 'accepted');
    writeRecord('decisions', 'DEC-001-y.md', 'accepted');
    const result = checkCitationAcceptance(ctx, taskWith(['REQ-001', 'DEC-001']));
    expect(result).toEqual({ allAccepted: true, unacceptedIds: [] });
  });

  it('names a citation that is still draft', () => {
    writeRecord('requirements', 'REQ-001-x.md', 'draft');
    const result = checkCitationAcceptance(ctx, taskWith(['REQ-001']));
    expect(result).toEqual({ allAccepted: false, unacceptedIds: ['REQ-001'] });
  });

  it('names a citation that has been superseded', () => {
    writeRecord('requirements', 'REQ-001-x.md', 'superseded');
    const result = checkCitationAcceptance(ctx, taskWith(['REQ-001']));
    expect(result.allAccepted).toBe(false);
    expect(result.unacceptedIds).toContain('REQ-001');
  });

  it('treats a citation whose record no longer exists on disk as unaccepted, not as a crash', () => {
    const result = checkCitationAcceptance(ctx, taskWith(['REQ-999']));
    expect(result).toEqual({ allAccepted: false, unacceptedIds: ['REQ-999'] });
  });

  it('ignores TASK- citations — only requirements and decisions have an acceptance lifecycle', () => {
    const result = checkCitationAcceptance(ctx, taskWith(['TASK-001']));
    expect(result).toEqual({ allAccepted: true, unacceptedIds: [] });
  });

  it('lists every unaccepted citation, not just the first', () => {
    writeRecord('requirements', 'REQ-001-x.md', 'draft');
    writeRecord('decisions', 'DEC-001-y.md', 'draft');
    writeRecord('requirements', 'REQ-002-z.md', 'accepted');
    const result = checkCitationAcceptance(ctx, taskWith(['REQ-001', 'DEC-001', 'REQ-002']));
    expect(result.allAccepted).toBe(false);
    expect(result.unacceptedIds).toEqual(['REQ-001', 'DEC-001']);
  });
});
