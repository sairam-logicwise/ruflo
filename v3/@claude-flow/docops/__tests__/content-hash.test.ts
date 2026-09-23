import { describe, it, expect } from 'vitest';
import { computeContentHash } from '../src/content-hash.js';

describe('computeContentHash', () => {
  it('is deterministic for identical input', () => {
    expect(computeContentHash({ a: 1 }, 'same text')).toBe(computeContentHash({ a: 1 }, 'same text'));
  });

  it('differs for different body', () => {
    expect(computeContentHash({ a: 1 }, 'a')).not.toBe(computeContentHash({ a: 1 }, 'b'));
  });

  it('produces a 64-char lowercase hex digest (sha256)', () => {
    expect(computeContentHash({}, 'anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across CRLF vs LF line endings (Important 5, review-2026-09-21.md)', () => {
    const lf = 'line one\nline two\nline three\n';
    const crlf = 'line one\r\nline two\r\nline three\r\n';
    expect(computeContentHash({}, lf)).toBe(computeContentHash({}, crlf));
  });

  // Review #3, Important 5: the hash now covers frontmatter too, not just the body.
  describe('frontmatter coverage (Important 5, review-2026-09-23.md)', () => {
    it('differs when a frontmatter field differs, body held constant', () => {
      const a = computeContentHash({ status: 'drafted' }, 'same body');
      const b = computeContentHash({ status: 'done' }, 'same body');
      expect(a).not.toBe(b);
    });

    it('is independent of top-level key order', () => {
      const a = computeContentHash({ status: 'done', priority: 'p1' }, 'body');
      const b = computeContentHash({ priority: 'p1', status: 'done' }, 'body');
      expect(a).toBe(b);
    });

    it('is independent of NESTED object key order — verified directly, this is the real bug a naive JSON.stringify(obj, sortedKeys) replacer would reintroduce', () => {
      const a = computeContentHash({ doneCriteria: { testLayers: ['unit'], coverageThreshold: 90 } }, 'body');
      const b = computeContentHash({ doneCriteria: { coverageThreshold: 90, testLayers: ['unit'] } }, 'body');
      expect(a).toBe(b);
    });

    it('detects a change to a NESTED field — this is the whole point (gate-relevant fields like doneCriteria/verification/estimate live nested)', () => {
      const a = computeContentHash({ doneCriteria: { testLayers: ['unit'] } }, 'body');
      const b = computeContentHash({ doneCriteria: { testLayers: ['unit', 'e2e'] } }, 'body');
      expect(a).not.toBe(b);
    });

    it('excludes contentHash itself from the hashed input — never depends on its own prior value', () => {
      const withOldHash = computeContentHash({ status: 'done', contentHash: 'aaaa' }, 'body');
      const withDifferentOldHash = computeContentHash({ status: 'done', contentHash: 'bbbb' }, 'body');
      const withNoHashField = computeContentHash({ status: 'done' }, 'body');
      expect(withOldHash).toBe(withDifferentOldHash);
      expect(withOldHash).toBe(withNoHashField);
    });

    it('array order in an array field DOES matter — arrays are real ordered data, not sorted away', () => {
      const a = computeContentHash({ citations: ['REQ-001', 'REQ-002'] }, 'body');
      const b = computeContentHash({ citations: ['REQ-002', 'REQ-001'] }, 'body');
      expect(a).not.toBe(b);
    });

    // A caller-discovered follow-on to Important 5: `buildVerificationReceipt`
    // (records-io.ts) stamps its own receipt with a contentHash meant to equal
    // the record's — but the receipt is built from the pre-transition
    // frontmatter, and the top-level hash is finalized post-transition. If
    // `verification` counted toward the hash, those two would only agree by
    // circular luck. Excluding it, like `contentHash` itself, makes them the
    // same formula over the same fields regardless of transition order.
    describe('excludes `verification` from the hashed input, same treatment as contentHash', () => {
      it('is unaffected by adding, removing, or changing a verification block', () => {
        const bare = computeContentHash({ status: 'done' }, 'body');
        const withReceipt = computeContentHash({ status: 'done', verification: { exitCode: 0, contentHash: 'whatever' } }, 'body');
        const withDifferentReceipt = computeContentHash({ status: 'done', verification: { exitCode: 1, contentHash: 'anything-else' } }, 'body');
        expect(withReceipt).toBe(bare);
        expect(withDifferentReceipt).toBe(bare);
      });

      it('lets a receipt built from the pre-transition frontmatter still equal the post-transition top-level hash', () => {
        const preTransition = { status: 'verifying', citations: ['REQ-001'] };
        const receiptHash = computeContentHash(preTransition, 'body'); // records-io.ts's buildVerificationReceipt call
        const postTransition = { ...preTransition, status: 'done', verification: { exitCode: 0, contentHash: receiptHash } };
        const finalTopLevelHash = computeContentHash(postTransition, 'body'); // records-io.ts's finalizeContentHash call

        // Not equal to the receipt hash — status genuinely changed, and that must be caught.
        expect(finalTopLevelHash).not.toBe(receiptHash);
        // But a SECOND receipt built after the transition, from the same finalized fields, does agree —
        // this is the real invariant phase-check.ts's auditDoneReceipt relies on for a genuinely fresh receipt.
        const { verification: _v, ...substantive } = postTransition;
        expect(computeContentHash(substantive, 'body')).toBe(finalTopLevelHash);
      });
    });
  });
});
