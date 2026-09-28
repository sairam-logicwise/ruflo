/**
 * model-prices.ts — Single source of truth for per-model pricing.
 *
 * Iter 31 — Previously the price table existed in three scripts (train-
 * bundled-krr.mjs, auto-retrain-router.mjs, calibration-check.mjs) AND was
 * derived from the openrouter-alts.json sidecar for the bundled list. As
 * cost-aware features land (trajectory outcomes, cost-savings observability,
 * cost-ceiling routing), they need ONE canonical price lookup. This module
 * is it.
 *
 * T12 (agentic SDLC plan) — a second, disagreeing table also existed in
 * gaia-bench.ts. That table is gone; gaia-bench now imports `costUsd` from
 * here, same as every other caller.
 *
 * Prices are blended ($/Mtok) using a 1×input + 3×output mix, reflecting
 * the average input/output token ratio for code tasks. To compute spend
 * for a specific call:
 *
 *   const usd = costUsd(modelId, inputTokens, outputTokens);
 *
 * Unknown model ids THROW (UnknownModelPriceError) rather than falling back
 * to a guessed rate — a silently wrong price is worse than a loud failure,
 * since every downstream quote and budget check trusts this number.
 *
 * Source: OpenRouter price page snapshot, ADR-149 bench dates.
 *
 * @module model-prices
 */

/** Per-million-token input and output prices ($USD). */
export interface ModelPrice {
  in: number;
  out: number;
}

/**
 * Curated price table. Keys are concrete model ids matching either
 * OpenRouter slugs, Anthropic SDK ids, or the router's own coarse tier
 * names, that the cost-optimal router can choose. New models added via the
 * registry sidecar should be reflected here AS THEY ARE ADDED (no
 * auto-sync); see ADR-149.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Cheap tier
  'inclusionai/ling-2.6-flash':         { in: 0.01,  out: 0.03 },
  'google/gemini-2.5-flash-lite':       { in: 0.10,  out: 0.40 },
  'meta-llama/llama-3.3-70b-instruct':  { in: 0.13,  out: 0.40 },
  // Mid tier
  'anthropic/claude-haiku-3':           { in: 0.25,  out: 1.25 },
  'anthropic/claude-haiku-4.5':         { in: 1.00,  out: 5.00 },
  'openai/gpt-4.1':                     { in: 2.00,  out: 8.00 },
  // Strong tier
  'anthropic/claude-sonnet-4-5':        { in: 3.00,  out: 15.00 },
  'anthropic/claude-sonnet-4-6':        { in: 3.00,  out: 15.00 },
  'anthropic/claude-opus-4':            { in: 15.00, out: 75.00 },
  'anthropic/claude-opus-4-5':          { in: 15.00, out: 75.00 },
  // Tier-label fallbacks (when the trajectory only carries a coarse tier
  // and not a concrete modelId — happens before iter 13 wiring landed).
  haiku:   { in: 1.00,  out: 5.00 },
  sonnet:  { in: 3.00,  out: 15.00 },
  opus:    { in: 15.00, out: 75.00 },
  inherit: { in: 3.00,  out: 15.00 },
};

/**
 * Bare/dash model ids used by callers outside this module (e.g. gaia-bench's
 * `--models` CLI flag) that don't carry a provider prefix. Mapped explicitly
 * onto the canonical `MODEL_PRICES` entries above rather than derived by
 * string-munging — an id not listed here is genuinely unknown and throws,
 * instead of being guessed at by a normalization heuristic.
 */
const MODEL_ALIASES: Record<string, string> = {
  'claude-haiku-3': 'anthropic/claude-haiku-3',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  'claude-sonnet-4-5': 'anthropic/claude-sonnet-4-5',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4-5': 'anthropic/claude-opus-4-5',
};

/** Thrown by `blendedPrice`/`costUsd` when a model id has no price entry. */
export class UnknownModelPriceError extends Error {
  constructor(modelId: string) {
    super(
      `No price entry for model "${modelId}". Add it to MODEL_PRICES or ` +
        `MODEL_ALIASES in model-prices.ts — refusing to guess a rate.`,
    );
    this.name = 'UnknownModelPriceError';
  }
}

function lookupPrice(modelId: string): ModelPrice | undefined {
  return MODEL_PRICES[modelId] ?? MODEL_PRICES[MODEL_ALIASES[modelId] ?? ''];
}

/**
 * Blended $/Mtok using the 1× input + 3× output ratio. Used by the KRR
 * trainer (scripts/train-bundled-krr.mjs and others) as the cost feature
 * the cost-optimal selector divides quality by.
 *
 * @throws {UnknownModelPriceError} if `modelId` has no price entry.
 */
export function blendedPrice(modelId: string): number {
  const p = lookupPrice(modelId);
  if (!p) throw new UnknownModelPriceError(modelId);
  return p.in + 3 * p.out;
}

/**
 * Compute USD spend for a single call. Cost = (input × $/Mtok_in +
 * output × $/Mtok_out) / 1_000_000.
 *
 * Returns 0 when there is no usage to price (nothing was spent). Throws
 * {@link UnknownModelPriceError} when a model id is given but unrecognized —
 * callers that must not throw (e.g. best-effort telemetry) should catch
 * this explicitly and decide how to degrade; see `router-trajectory.ts`.
 *
 * @throws {UnknownModelPriceError} if `modelId` is a non-empty string with
 *   no price entry.
 */
export function costUsd(
  modelId: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number {
  const inT = inputTokens ?? 0;
  const outT = outputTokens ?? 0;
  if (!inT && !outT) return 0;
  if (!modelId) throw new UnknownModelPriceError('(none)');
  const p = lookupPrice(modelId);
  if (!p) throw new UnknownModelPriceError(modelId);
  return (inT * p.in + outT * p.out) / 1_000_000;
}
