/**
 * records-io.ts — formatValidationError. Regression test for a real bug
 * found only by running the real compiled CLI (T21): ReadabilityError
 * carries its own `issues` array shaped `{rule, sentence, message}`, and
 * the old ZodError duck-type check (`Array.isArray(error.issues)` alone)
 * matched it too, then crashed on the missing `path` field.
 */

import { describe, it, expect } from 'vitest';
import { formatValidationError } from '../src/commands/records-io.js';
import { ReadabilityError } from '@claude-flow/docops';

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
