/**
 * train-price-guard.mjs — shared price-map guard used by the router
 * training scripts (Important 17, review-2026-09-21.md; new problem 1 and
 * the empty-price-map hard-failure, review-2026-09-22.md).
 */

import { describe, it, expect } from 'vitest';
import { priceKnownCandidates } from '../train-price-guard.mjs';

const REAL_MODEL = 'anthropic/claude-haiku-4.5'; // priced in model-prices.ts
const FAKE_MODEL = 'totally/fake-unpriced-model';

function row(scores) {
  return { scores: { ...scores } };
}

describe('priceKnownCandidates', () => {
  it('prices every candidate when all are known', () => {
    const rows = [row({ [REAL_MODEL]: 0.9 })];
    const prices = priceKnownCandidates(rows, 'test');
    expect(prices[REAL_MODEL]).toBeGreaterThan(0);
    expect(rows[0].scores).toEqual({ [REAL_MODEL]: 0.9 });
  });

  it('skips an unpriced model, warns, and excludes it from the price map', () => {
    const rows = [row({ [REAL_MODEL]: 0.9, [FAKE_MODEL]: 0.8 })];
    const prices = priceKnownCandidates(rows, 'test');
    expect(Object.keys(prices)).toEqual([REAL_MODEL]);
    expect(prices[FAKE_MODEL]).toBeUndefined();
  });

  it('deletes the unpriced model from every row\'s scores, not just the price map', () => {
    // The real risk (Important 17): @metaharness/router derives its
    // candidate list from rows[].scores, not from the price map, so a
    // stray score entry left behind would still reach trainRouter and
    // default to costPerMTok: 0 — looking free.
    const rows = [
      row({ [REAL_MODEL]: 0.9, [FAKE_MODEL]: 0.8 }),
      row({ [REAL_MODEL]: 0.7, [FAKE_MODEL]: 0.6 }),
    ];
    priceKnownCandidates(rows, 'test');
    for (const r of rows) {
      expect(Object.keys(r.scores)).toEqual([REAL_MODEL]);
    }
  });

  it('throws a clear, actionable error when every candidate is unpriced (new problem 1, review-2026-09-22.md)', () => {
    // Left unguarded, this used to return {} silently, every row's scores
    // would become {} too, and the caller's trainRouter(rows, {}, ...)
    // would fail deep inside @metaharness/router with a confusing "needs
    // at least one candidate" error instead of a clear one at the actual
    // point of failure.
    const rows = [row({ [FAKE_MODEL]: 0.9 })];
    expect(() => priceKnownCandidates(rows, 'test')).toThrow(/none of the 1 candidate/);
    expect(() => priceKnownCandidates(rows, 'test')).toThrow(FAKE_MODEL);
  });

  it('does not throw on an empty corpus (zero candidates is not the same as zero priced candidates)', () => {
    const rows = [];
    expect(() => priceKnownCandidates(rows, 'test')).not.toThrow();
    expect(priceKnownCandidates(rows, 'test')).toEqual({});
  });
});
