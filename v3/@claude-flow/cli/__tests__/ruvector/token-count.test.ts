/**
 * T12 (agentic SDLC plan) — real tokenizer, replacing `text.length / 4`.
 */

import { describe, it, expect } from 'vitest';
import { countTokens } from '../../src/ruvector/token-count.js';

describe('countTokens', () => {
  it('counts a known code sample correctly (not the old length/4 heuristic)', () => {
    const sample = 'function add(a, b) { return a + b; }';
    // cl100k_base tokenization of this exact string is 13 tokens.
    // The old heuristic would have said Math.ceil(36 / 4) = 9 — a
    // materially different (and wrong) number for code.
    expect(countTokens(sample)).toBe(13);
    expect(countTokens(sample)).not.toBe(Math.ceil(sample.length / 4));
  });

  it('uses cl100k_base specifically, not o200k_base (C3, review-2026-09-21.md)', () => {
    // Chosen because the two encodings disagree on it: cl100k_base = 16,
    // o200k_base = 14 (verified directly against both subpath imports).
    // The earlier code/Unicode-free samples in this file happen to tokenize
    // identically under every gpt-tokenizer encoding, so they couldn't have
    // caught the module resolving to the wrong one.
    const sample = 'const café = () => { return "日本語 test €"; };';
    expect(countTokens(sample)).toBe(16);
  });

  it('returns 0 for empty input', () => {
    expect(countTokens('')).toBe(0);
  });

  it('is deterministic for identical input', () => {
    const text = 'const x: number[] = [1, 2, 3];';
    expect(countTokens(text)).toBe(countTokens(text));
  });
});
