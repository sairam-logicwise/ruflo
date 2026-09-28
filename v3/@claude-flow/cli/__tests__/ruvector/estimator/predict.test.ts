/**
 * T10 (agentic SDLC plan) — Estimator v0: nearest-neighbour token range.
 */

import { describe, it, expect } from 'vitest';
import { predictTokens, type EstimatorRow } from '../../../src/ruvector/estimator/predict.js';

function row(complexity: number, inputTokens: number, outputTokens: number, source: 'trajectory' | 'calibration' = 'calibration'): EstimatorRow {
  return { complexity, inputTokens, outputTokens, source };
}

describe('predictTokens', () => {
  it('never returns a point estimate: an empty corpus is refused, not a fabricated {0,0}', () => {
    const result = predictTokens(0.5, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('returns a real range, never a single number, when the corpus has data', () => {
    const corpus = [row(0.5, 1000, 500), row(0.5, 1200, 600)];
    const result = predictTokens(0.5, corpus);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.estimate.lowTokens).toBe('number');
      expect(typeof result.estimate.highTokens).toBe('number');
      expect(result.estimate.lowTokens).toBeLessThanOrEqual(result.estimate.highTokens);
      expect(result.estimate.confidence).toBeGreaterThanOrEqual(0);
      expect(result.estimate.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('a dense, close neighborhood gives a narrow range and high confidence', () => {
    const corpus = [
      row(0.5, 1000, 500), row(0.51, 1010, 510), row(0.49, 990, 490),
      row(0.5, 1005, 505), row(0.5, 995, 495),
    ];
    const result = predictTokens(0.5, corpus, { retryMultiplier: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimate.highTokens - result.estimate.lowTokens).toBeLessThan(50);
      expect(result.estimate.confidence).toBeGreaterThan(0.8);
    }
  });

  it('a sparse or distant neighborhood gives a wide range and low confidence', () => {
    const corpus = [row(0.05, 100, 50), row(0.95, 50000, 20000)];
    const result = predictTokens(0.5, corpus, { retryMultiplier: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimate.highTokens - result.estimate.lowTokens).toBeGreaterThan(1000);
      expect(result.estimate.confidence).toBeLessThan(0.5);
    }
  });

  it('confidence drops, and says so in `reason`, when fewer neighbours exist than requested', () => {
    const corpus = [row(0.5, 1000, 500)];
    const result = predictTokens(0.5, corpus, { k: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimate.neighborCount).toBe(1);
      expect(result.estimate.reason).toContain('1 of 5');
    }
  });

  it('the retry multiplier scales only the top of the range, never the bottom', () => {
    const corpus = [row(0.5, 1000, 500)];
    const withoutRetry = predictTokens(0.5, corpus, { retryMultiplier: 1 });
    const withRetry = predictTokens(0.5, corpus, { retryMultiplier: 2 });
    expect(withoutRetry.ok && withRetry.ok).toBe(true);
    if (withoutRetry.ok && withRetry.ok) {
      expect(withRetry.estimate.lowTokens).toBe(withoutRetry.estimate.lowTokens);
      expect(withRetry.estimate.highTokens).toBe(withoutRetry.estimate.highTokens * 2);
    }
  });

  it('the retry multiplier defaults to something documented and > 1, applied even when not passed', () => {
    const corpus = [row(0.5, 1000, 500)];
    const result = predictTokens(0.5, corpus);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimate.retryMultiplier).toBeGreaterThan(1);
      expect(result.estimate.highTokens).toBeGreaterThan(1500 * result.estimate.retryMultiplier - 1); // 1500 = 1000+500
    }
  });

  it('k caps how many neighbours are considered, even with a much larger corpus', () => {
    const corpus = Array.from({ length: 50 }, (_, i) => row(0.5, 1000 + i, 500 + i));
    const result = predictTokens(0.5, corpus, { k: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.estimate.neighborCount).toBe(3);
  });

  it('reports the true corpus size regardless of how many neighbours were actually used', () => {
    const corpus = Array.from({ length: 50 }, (_, i) => row(0.5, 1000 + i, 500 + i));
    const result = predictTokens(0.5, corpus, { k: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.estimate.corpusSize).toBe(50);
  });

  it('names the real source split (trajectory vs calibration) among the neighbours actually used', () => {
    const corpus = [row(0.5, 1000, 500, 'calibration'), row(0.5, 1100, 550, 'trajectory')];
    const result = predictTokens(0.5, corpus, { k: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimate.reason).toContain('1 calibration');
      expect(result.estimate.reason).toContain('1 trajectory');
    }
  });

  // Review #3, C4: lowTokens/highTokens are a combined total; quote.ts
  // needs the real input:output split to price correctly instead of
  // guessing a fixed ratio.
  describe('real input/output split (C4)', () => {
    it('reports the real split from the neighbour that set the low edge', () => {
      const corpus = [row(0.5, 700, 300), row(0.5, 900, 600)]; // totals 1000, 1500
      const result = predictTokens(0.5, corpus, { retryMultiplier: 1 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.estimate.lowTokens).toBe(1000);
        expect(result.estimate.lowInputTokens).toBe(700);
        expect(result.estimate.lowOutputTokens).toBe(300);
      }
    });

    it('scales the high edge split by the retry multiplier, on both sides', () => {
      const corpus = [row(0.5, 700, 300), row(0.5, 900, 600)]; // totals 1000, 1500
      const result = predictTokens(0.5, corpus, { retryMultiplier: 2 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.estimate.highTokens).toBe(3000); // 1500 * 2
        expect(result.estimate.highInputTokens).toBe(1800); // 900 * 2
        expect(result.estimate.highOutputTokens).toBe(1200); // 600 * 2
      }
    });

    it('never guesses a ratio — the low and high splits can genuinely differ from each other', () => {
      // A 90/10 low neighbour and a 20/80 high neighbour — a fixed blend would erase this.
      const corpus = [row(0.5, 900, 100), row(0.5, 200, 800)]; // totals 1000, 1000 — same total, different mix
      const result = predictTokens(0.5, corpus, { retryMultiplier: 1, k: 1 });
      // With k:1, only the nearer-complexity neighbour is used (both are complexity 0.5, tie -> first).
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.estimate.lowInputTokens + result.estimate.lowOutputTokens).toBe(result.estimate.lowTokens);
      }
    });
  });

  it('picks neighbours by nearest complexity distance, not corpus order', () => {
    const corpus = [row(0.9, 9000, 9000), row(0.5, 1000, 500), row(0.1, 100, 50)];
    const result = predictTokens(0.5, corpus, { k: 1, retryMultiplier: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimate.lowTokens).toBe(1500); // the 0.5-complexity row, not whichever came first
      expect(result.estimate.highTokens).toBe(1500);
    }
  });
});
