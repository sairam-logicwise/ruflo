/**
 * T12 (agentic SDLC plan) — pricing/tokenizer bug fixes.
 * Covers: single price table, unknown model throws (never guesses),
 * costUsd's zero-usage short circuit still works.
 */

import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICES,
  blendedPrice,
  costUsd,
  UnknownModelPriceError,
} from '../../src/ruvector/model-prices.js';

describe('model-prices', () => {
  it('prices a known model correctly', () => {
    expect(MODEL_PRICES['openai/gpt-4.1']).toEqual({ in: 2.0, out: 8.0 });
    // 1000 input × $2/Mtok + 500 output × $8/Mtok = ($2000 + $4000) / 1e6
    expect(costUsd('openai/gpt-4.1', 1000, 500)).toBeCloseTo(0.006, 5);
  });

  it('resolves bare dash-form aliases onto the canonical anthropic/ entries', () => {
    expect(blendedPrice('claude-haiku-4-5')).toBe(blendedPrice('anthropic/claude-haiku-4.5'));
    expect(costUsd('claude-sonnet-4-6', 1000, 1000)).toBe(
      costUsd('anthropic/claude-sonnet-4-6', 1000, 1000),
    );
  });

  it('throws with the model name for an unrecognized model, never guesses', () => {
    expect(() => blendedPrice('some/unknown-model')).toThrow(UnknownModelPriceError);
    expect(() => blendedPrice('some/unknown-model')).toThrow(/some\/unknown-model/);
    expect(() => costUsd('some/unknown-model', 1000, 1000)).toThrow(UnknownModelPriceError);
  });

  it('throws when tokens are spent but no model id is given at all', () => {
    expect(() => costUsd(undefined, 1000, 0)).toThrow(UnknownModelPriceError);
  });

  it('returns 0 with no throw when there is nothing to price, even for an unknown model', () => {
    expect(costUsd('some/unknown-model', 0, 0)).toBe(0);
    expect(costUsd(undefined, undefined, undefined)).toBe(0);
  });

  it('has exactly one price table — tier aliases and provider-prefixed ids agree', () => {
    // haiku tier alias must match the anthropic/claude-haiku-4.5 entry it
    // stands in for (this is the disagreement T12 fixed: gaia-bench used to
    // carry a second table pricing this model at $0.25/$1.25 instead).
    expect(MODEL_PRICES.haiku).toEqual(MODEL_PRICES['anthropic/claude-haiku-4.5']);
    expect(MODEL_PRICES.sonnet).toEqual(MODEL_PRICES['anthropic/claude-sonnet-4-6']);
    expect(MODEL_PRICES.opus).toEqual(MODEL_PRICES['anthropic/claude-opus-4']);
  });
});
