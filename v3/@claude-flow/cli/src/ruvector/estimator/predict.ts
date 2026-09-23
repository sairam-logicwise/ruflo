/**
 * predict.ts — Estimator v0 (T10, agentic SDLC plan, tasks/plan.md).
 *
 * Given a task's complexity score, finds the k nearest corpus rows by
 * complexity distance and returns a token RANGE with a confidence level —
 * never a single number. Nearest-neighbour, not regression, on purpose
 * (plan.md's own rationale): it degrades gracefully with a small corpus
 * and tightens as history grows, with no retraining step, no model file,
 * nothing to go stale.
 *
 * The corpus is deliberately reduced to ONE shared dimension —
 * `complexity` (0-1, `analyzeTaskComplexity()`'s own score) — because it
 * is the only feature T7's trajectory rows (task text + complexity only)
 * and T8's calibration task records (T9's full feature vector) have in
 * common. T9's richer per-task features (files touched, test layers,
 * citation closure) are NOT used for neighbour distance in v0; folding
 * them in would need real weights this repo has no evidence for yet
 * (fabricating them would be worse than not using them at all — the same
 * reasoning behind every other "no fake precision" call this plan makes).
 *
 * @module estimator/predict
 */

/** One labelled corpus row this predictor can learn from — deliberately just the fields comparable across T7's trajectory corpus and T8's calibration task records. */
export interface EstimatorRow {
  complexity: number;
  inputTokens: number;
  outputTokens: number;
  /** T7's trajectory log is a prior from a different domain (plan.md's own words); T8's calibration set is real, in-domain ground truth. Kept, not used to filter — a caller can weight or report by source if it wants to. */
  source: 'trajectory' | 'calibration';
}

export interface PredictOptions {
  /** Neighbours considered, at most. Default 5 — small enough to stay local, large enough that one outlier row can't set the whole range alone. */
  k?: number;
  /**
   * Multiplies the top of the range only, never the bottom — a retry or
   * repair round (T20) only ever ADDS tokens on top of a base attempt, it
   * never makes the cheapest real outcome cheaper. Default 1.3: a 30%
   * buffer. No real retry-cost history exists yet to derive this from
   * data (T20 has run zero real repairs at the time of writing) — stated
   * as a stated assumption, not measured, and it is the literal thing
   * `ruflo quote` (T11) must name in its own output per that task's own
   * acceptance criterion.
   */
  retryMultiplier?: number;
}

export interface Estimate {
  lowTokens: number;
  highTokens: number;
  /** 0-1. A heuristic, not a statistical confidence interval — see computeConfidence()'s own doc comment for exactly what it is and is not. */
  confidence: number;
  neighborCount: number;
  corpusSize: number;
  retryMultiplier: number;
  /** Always populated, not just when confidence is low — names the neighbours this estimate actually came from. */
  reason: string;
}

export type PredictionResult =
  | { ok: true; estimate: Estimate }
  | { ok: false; reason: string };

const DEFAULT_K = 5;
const DEFAULT_RETRY_MULTIPLIER = 1.3;

/**
 * A heuristic blend of two things, each independently a reason to trust
 * an estimate less: fewer neighbours than asked for (a thin corpus at
 * this complexity), neighbours that are far from the query in complexity
 * (a mismatched corpus, not a thin one), and — added after a real
 * leave-one-out hold-out run against T8's actual calibration set exposed
 * it (`scripts/estimator-holdout-check.mjs`) — neighbours whose TOKEN
 * totals disagree wildly even when their complexity scores are close.
 * The first version of this function scored `[603, 24842]` (a >40x
 * spread) at 0.90 confidence, because the 5 neighbours it picked all
 * happened to sit near the same complexity score — complexity-closeness
 * alone said nothing about whether those neighbours actually agreed on
 * cost. A real hold-out run at only a 75% hit rate with confidence
 * mostly above 0.9 was the honest signal something was wrong: an
 * overconfident number is worse than none, since a stakeholder reading a
 * quote (T11) has no way to tell a well-supported 0.9 from a
 * badly-supported one.
 *
 * None of this is a real statistical confidence interval — there is no
 * distribution being fitted, no p-value, nothing that would make "0.62"
 * a rigorous number. It IS monotonic in the three things that should
 * intuitively lower trust, which is what plan.md's acceptance criterion
 * ("confidence drops when no near neighbour exists") actually asks for.
 */
function computeConfidence(neighborCount: number, k: number, avgDistance: number, totals: number[]): number {
  const coverage = neighborCount / k; // 1.0 with a full k, less with a thin corpus
  const closeness = Math.max(0, 1 - avgDistance); // complexity is 0-1, so distance is too
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  // Scale-free spread: (max-min)/(max+min) scores a [1000,1100] range and a
  // [100000,110000] range identically "tight" — the right comparison across
  // task sizes that can differ by orders of magnitude in raw token count.
  const spread = max + min > 0 ? (max - min) / (max + min) : 0;
  const tightness = Math.max(0, 1 - spread);
  return Math.max(0, Math.min(1, coverage * closeness * tightness));
}

/**
 * Predicts a token range for a task at the given complexity score, from
 * `corpus` — the caller's job to assemble (T7's trajectory rows plus T8's
 * calibration task records; see corpus.ts). Never returns a bare number
 * anywhere in this API: an empty corpus is `{ ok: false }`, not a
 * fabricated `{ lowTokens: 0, highTokens: 0 }` — there is a real
 * difference between "we estimate zero" and "we cannot estimate," and
 * collapsing them would be a lie a caller (T11's `ruflo quote`) could
 * easily repeat without meaning to.
 */
export function predictTokens(complexityScore: number, corpus: EstimatorRow[], opts: PredictOptions = {}): PredictionResult {
  const k = opts.k ?? DEFAULT_K;
  const retryMultiplier = opts.retryMultiplier ?? DEFAULT_RETRY_MULTIPLIER;

  if (corpus.length === 0) {
    return { ok: false, reason: 'no corpus data available — nothing to estimate from (T7 trajectory log and T8 calibration set are both empty)' };
  }

  const withDistance = corpus
    .map((row) => ({ row, distance: Math.abs(row.complexity - complexityScore) }))
    .sort((a, b) => a.distance - b.distance);

  const neighbors = withDistance.slice(0, Math.min(k, withDistance.length));
  const totals = neighbors.map((n) => n.row.inputTokens + n.row.outputTokens);
  const avgDistance = neighbors.reduce((sum, n) => sum + n.distance, 0) / neighbors.length;

  const lowTokens = Math.min(...totals);
  const highTokens = Math.round(Math.max(...totals) * retryMultiplier);
  const confidence = computeConfidence(neighbors.length, k, avgDistance, totals);

  const bySource = { trajectory: 0, calibration: 0 };
  for (const n of neighbors) bySource[n.row.source]++;

  return {
    ok: true,
    estimate: {
      lowTokens,
      highTokens,
      confidence,
      neighborCount: neighbors.length,
      corpusSize: corpus.length,
      retryMultiplier,
      reason: `${neighbors.length} of ${k} requested neighbour(s) found (${bySource.calibration} calibration, ${bySource.trajectory} trajectory), average complexity distance ${avgDistance.toFixed(3)}`,
    },
  };
}
