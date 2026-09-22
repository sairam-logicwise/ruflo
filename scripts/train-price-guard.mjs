// train-price-guard.mjs — shared price-map guard for the router training
// scripts (Important 17, review-2026-09-21.md).
//
// T12 removed blendedPrice()'s silent-guess fallback: an id with no entry
// in model-prices.ts now throws UnknownModelPriceError instead of quietly
// returning $1/Mtok. Left as-is, that throw aborts the ENTIRE batch train
// over one unrecognized model in the corpus — and the alternative of just
// swallowing the error and letting @metaharness/router's own internal
// `prices[id] ?? 0` fallback take over is worse: trainRouter derives its
// candidate list from `rows[].scores`, not from the price map, so an
// unpriced model would silently look FREE and could win every cost-optimal
// route.
//
// The explicit policy: skip that one model — warn loudly, exclude it from
// the price map AND delete its score entries from every row so it can never
// reach trainRouter as a $0 candidate — and keep training on the rest of
// the corpus.

import { blendedPrice } from '../v3/@claude-flow/cli/dist/src/ruvector/model-prices.js';

/**
 * Prices every candidate model referenced across `rows[].scores`. Mutates
 * `rows` in place, deleting the score entry for any model with no known
 * price, and returns the price map for the remaining candidates.
 *
 * Throws if EVERY candidate turns out unpriced (new problem 1,
 * review-2026-09-22.md): silently returning `{}` would leave every row's
 * `scores` empty too, and the caller's `trainRouter(rows, {}, ...)` would
 * then fail deep inside @metaharness/router with a confusing "needs at
 * least one candidate" error instead of a clear one naming the actual
 * cause, at the point where it's actually diagnosable.
 *
 * @param {Array<{ scores: Record<string, number> }>} rows
 * @param {string} label log prefix, e.g. 'train' / 'calibrate'
 * @throws {Error} if no candidate in `rows` has a known price
 */
export function priceKnownCandidates(rows, label) {
  const ids = [...new Set(rows.flatMap((r) => Object.keys(r.scores)))];
  const prices = {};
  for (const id of ids) {
    try {
      prices[id] = blendedPrice(id);
    } catch {
      console.warn(`[${label}] skipping "${id}" — no known price in model-prices.ts; excluding it from this training run.`);
    }
  }
  if (ids.length > 0 && Object.keys(prices).length === 0) {
    throw new Error(
      `[${label}] none of the ${ids.length} candidate model(s) in this corpus have a known price ` +
        `(${ids.join(', ')}) — nothing left to train on. Add them to model-prices.ts, or check the corpus for stale/renamed model ids.`,
    );
  }
  const known = new Set(Object.keys(prices));
  for (const row of rows) {
    for (const id of Object.keys(row.scores)) {
      if (!known.has(id)) delete row.scores[id];
    }
  }
  return prices;
}
