import { describe, it, expect } from 'vitest';
import { computeContentHash } from '../src/content-hash.js';

describe('computeContentHash', () => {
  it('is deterministic for identical input', () => {
    expect(computeContentHash('same text')).toBe(computeContentHash('same text'));
  });

  it('differs for different input', () => {
    expect(computeContentHash('a')).not.toBe(computeContentHash('b'));
  });

  it('produces a 64-char lowercase hex digest (sha256)', () => {
    expect(computeContentHash('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across CRLF vs LF line endings (Important 5, review-2026-09-21.md)', () => {
    const lf = 'line one\nline two\nline three\n';
    const crlf = 'line one\r\nline two\r\nline three\r\n';
    expect(computeContentHash(lf)).toBe(computeContentHash(crlf));
  });
});
