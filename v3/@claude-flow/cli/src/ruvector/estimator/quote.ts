/**
 * quote.ts — roll up estimates across a requirement's decomposed tasks
 * into one priced range (T11, agentic SDLC plan, tasks/plan.md). Built
 * from TASK-021's own real body (T6's real decomposition of REQ-001 —
 * this task's own requirement): "Given a requirement id, load every task
 * record citing it. Run T10's predictTokens on each. Combine the
 * individual ranges into one requirement-level range: sum lowTokens and
 * highTokens, and combine confidence honestly, never averaging away a
 * genuinely low individual confidence. Name any task with no estimator
 * prediction available explicitly in the output, rather than silently
 * dropping it from the sum."
 *
 * "Combine confidence honestly" is MIN across predicted tasks, not a
 * mean — a mean lets one high-confidence task hide a genuinely
 * low-confidence one; a stakeholder reading one number needs the
 * roll-up's confidence to be exactly as trustworthy as its weakest real
 * input, the same reasoning predict.ts's own doc comment gives for not
 * averaging away a wide token spread into a falsely tight range.
 *
 * Pricing (fixed, review #3 C4): T10's `predictTokens()` now returns the
 * REAL input/output split from whichever neighbour row actually set each
 * edge of the range (`lowInputTokens`/`lowOutputTokens`/
 * `highInputTokens`/`highOutputTokens` on `Estimate`) — summed across
 * every predicted task, then priced with `costUsd()`'s real per-model
 * input/output rates. The earlier version priced the combined total with
 * `blendedPrice()`'s hardcoded 1x-input/3x-output mix, which over-priced
 * this corpus's real ~93.5%-input/6.5%-output split by 3.17x — confirmed
 * by execution, not a hypothetical.
 *
 * C3: a quote also refuses to state a dollar figure at all unless the
 * corpus behind it contains at least one row whose cost was REALLY
 * metered (`EstimatorRow.measured`), never only proxy-approximated rows
 * (T8's calibration pilot, before any real `usage` object existed for
 * this session). `lowCostUsd`/`highCostUsd` are `undefined` — not a
 * silently-computed-anyway number — until that's true; the token range
 * itself is unaffected, since a token range never depended on cost data
 * being measured in the first place.
 *
 * @module estimator/quote
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseRecordFile, validateRecord, type Task, type Requirement } from '@claude-flow/docops';
import { extractFeatures } from './features.js';
import { predictTokens, type EstimatorRow } from './predict.js';
import { loadCalibrationRows, loadEstimatorCorpus, buildUnifiedCorpus } from './corpus.js';
import { costUsd } from '../model-prices.js';

/** Default pricing reference — the same "nearest real proxy, coarse tier" fallback T8's calibration pilot used, since this session's own real model has no MODEL_PRICES entry. */
const DEFAULT_PRICE_ID = 'sonnet';

export interface TaskQuote {
  taskId: string;
  title: string;
  lowTokens: number;
  highTokens: number;
  confidence: number;
}

export interface UnpredictedTask {
  taskId: string;
  title: string;
  reason: string;
}

export interface Quote {
  requirementId: string;
  requirementTitle: string;
  lowTokens: number;
  highTokens: number;
  /** C3: undefined — never a silently-computed number — until the corpus behind this quote has at least one really-metered row. See `assumptions.hasMeasuredData`/`costCaveat`. */
  lowCostUsd: number | undefined;
  highCostUsd: number | undefined;
  /** MIN confidence across every predicted task — see module doc. */
  confidence: number;
  taskCount: number;
  perTask: TaskQuote[];
  /** Named explicitly, never silently dropped from the sum — TASK-021's own acceptance criterion. */
  unpredictedTasks: UnpredictedTask[];
  assumptions: {
    retryMultiplier: number;
    corpusSize: number;
    /** Actual neighbours predictTokens found per task (constant across every task in one quote — same corpus, same k). Named per this task's own acceptance criterion ("Output names the assumptions: retry multiplier, corpus size, neighbour count"). */
    neighborCount: number;
    priceId: string;
    pricingModel: string;
    /** C3: does the corpus behind this quote contain any REALLY metered row (EstimatorRow.measured)? false means every dollar figure was withheld, not guessed. */
    hasMeasuredData: boolean;
    /** Present only when hasMeasuredData is false — the reason no cost figure is given, meant to be shown to a stakeholder directly. */
    costCaveat?: string;
  };
}

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; reason: string };

export interface QuoteOptions {
  k?: number;
  retryMultiplier?: number;
  /** Model id priced against MODEL_PRICES/model-prices.ts's MODEL_ALIASES. Default 'sonnet' (coarse tier). */
  priceId?: string;
  graphPath?: string;
}

function readRecords<T>(dir: string, validate: (fm: Record<string, unknown>, body: string) => T | undefined): T[] {
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    const { frontmatter, body, parseError } = parseRecordFile(raw);
    if (parseError) continue;
    const record = validate(frontmatter, body);
    if (record !== undefined) out.push(record);
  }
  return out;
}

function loadRequirement(repoRoot: string, requirementId: string): Requirement | undefined {
  const dir = join(repoRoot, 'docs', 'requirements');
  const requirements = readRecords<Requirement>(dir, (frontmatter, body) => {
    const validated = validateRecord(frontmatter, body);
    return validated.success ? (validated.record as Requirement) : undefined;
  });
  return requirements.find((r) => r.id === requirementId);
}

interface TaskWithBody {
  task: Task;
  body: string;
}

function loadTasksCiting(repoRoot: string, requirementId: string): TaskWithBody[] {
  const dir = join(repoRoot, 'docs', 'tasks');
  return readRecords<TaskWithBody>(dir, (frontmatter, body) => {
    const validated = validateRecord(frontmatter, body);
    if (!validated.success) return undefined;
    const task = validated.record as Task;
    return task.citations.includes(requirementId) ? { task, body } : undefined;
  });
}

/** Builds the same T7+T8 unified corpus estimator-holdout-check.mjs uses, from the real on-disk trajectory log and calibration task records. */
function buildRealCorpus(repoRoot: string, graphPath?: string): EstimatorRow[] {
  const calibrationRows = loadCalibrationRows(repoRoot, graphPath);
  const trajectory = loadEstimatorCorpus(join(repoRoot, '.swarm', 'model-router-trajectories.jsonl'));
  return buildUnifiedCorpus(trajectory.rows, calibrationRows);
}

/**
 * Quotes one requirement: every task citing it, priced and summed. Never
 * a point estimate (AD-6) — `ok: false` when there is nothing real to
 * quote from (unknown requirement, no citing tasks, or a corpus so thin
 * every citing task comes back unpredictable), rather than a fabricated
 * zero.
 */
export function quoteRequirement(repoRoot: string, requirementId: string, opts: QuoteOptions = {}): QuoteResult {
  const requirement = loadRequirement(repoRoot, requirementId);
  if (!requirement) {
    return { ok: false, reason: `no requirement record found for ${requirementId}` };
  }

  const tasks = loadTasksCiting(repoRoot, requirementId);
  if (tasks.length === 0) {
    return { ok: false, reason: `no task cites ${requirementId} yet — nothing to quote` };
  }

  const corpus = buildRealCorpus(repoRoot, opts.graphPath);
  const priceId = opts.priceId ?? DEFAULT_PRICE_ID;
  costUsd(priceId, 1, 1); // throws UnknownModelPriceError on a bad --price-id, eagerly — same fail-loud contract as before, regardless of whether a cost figure ends up quoted
  const hasMeasuredData = corpus.some((row) => row.measured);

  const perTask: TaskQuote[] = [];
  const unpredictedTasks: UnpredictedTask[] = [];
  let lowTokens = 0;
  let highTokens = 0;
  let lowInputTokens = 0;
  let lowOutputTokens = 0;
  let highInputTokens = 0;
  let highOutputTokens = 0;
  let retryMultiplier = 1.3;
  let neighborCount = 0;

  for (const { task, body } of tasks) {
    // Real body, not a stub — loadCalibrationRows() (corpus.ts) scores every
    // calibration row's complexity from title+body the same way; scoring a
    // quoted task from title alone would compare it against corpus
    // neighbours on a different, incompatible complexity scale.
    const features = extractFeatures(
      { title: task.title, citations: task.citations, dependsOn: task.dependsOn },
      body,
      { repoRoot, ...(opts.graphPath ? { graphPath: opts.graphPath } : {}) },
    );
    const prediction = predictTokens(features.complexityScore, corpus, {
      ...(opts.k !== undefined ? { k: opts.k } : {}),
      ...(opts.retryMultiplier !== undefined ? { retryMultiplier: opts.retryMultiplier } : {}),
    });
    if (!prediction.ok) {
      unpredictedTasks.push({ taskId: task.id, title: task.title, reason: prediction.reason });
      continue;
    }
    const { estimate } = prediction;
    retryMultiplier = estimate.retryMultiplier;
    neighborCount = estimate.neighborCount;
    lowTokens += estimate.lowTokens;
    highTokens += estimate.highTokens;
    lowInputTokens += estimate.lowInputTokens;
    lowOutputTokens += estimate.lowOutputTokens;
    highInputTokens += estimate.highInputTokens;
    highOutputTokens += estimate.highOutputTokens;
    perTask.push({ taskId: task.id, title: task.title, lowTokens: estimate.lowTokens, highTokens: estimate.highTokens, confidence: estimate.confidence });
  }

  if (perTask.length === 0) {
    return {
      ok: false,
      reason: `${tasks.length} task(s) cite ${requirementId} but none could be estimated (${unpredictedTasks.map((u) => u.taskId).join(', ')}) — corpus too thin`,
    };
  }

  const confidence = Math.min(...perTask.map((t) => t.confidence));

  // C3: withhold a dollar figure entirely rather than price a corpus that
  // has never actually measured a real cost — see module doc.
  const costCaveat = hasMeasuredData
    ? undefined
    : `no measured cost data yet — every actuals row behind this quote is a proxy approximation (T8's calibration pilot); a token range is still real, a dollar figure would not be`;

  return {
    ok: true,
    quote: {
      requirementId,
      requirementTitle: requirement.title,
      lowTokens,
      highTokens,
      lowCostUsd: hasMeasuredData ? costUsd(priceId, lowInputTokens, lowOutputTokens) : undefined,
      highCostUsd: hasMeasuredData ? costUsd(priceId, highInputTokens, highOutputTokens) : undefined,
      confidence,
      taskCount: tasks.length,
      perTask,
      unpredictedTasks,
      assumptions: {
        hasMeasuredData,
        ...(costCaveat ? { costCaveat } : {}),
        retryMultiplier,
        corpusSize: corpus.length,
        neighborCount,
        priceId,
        pricingModel: 'real per-model input/output rates (model-prices.ts costUsd), split by the actual neighbour rows predictTokens used — not a blended/assumed ratio',
      },
    },
  };
}

/**
 * Backlog roll-up (TASK-018): quotes every requirement in `requirementIds`
 * and sums across them. Skips a requirement `quoteRequirement` itself
 * couldn't quote, naming it the same way an individual unpredicted task
 * is named — never silently dropped.
 */
export interface BacklogQuote {
  lowTokens: number;
  highTokens: number;
  /** C3: undefined only when NOT ONE requirement quote in this backlog has measured cost data. Otherwise sums whichever quotes do — see requirementsWithoutMeasuredCost for what was excluded. */
  lowCostUsd: number | undefined;
  highCostUsd: number | undefined;
  confidence: number;
  requirementQuotes: Quote[];
  skippedRequirements: { requirementId: string; reason: string }[];
  /** Requirement ids counted in lowTokens/highTokens but excluded from lowCostUsd/highCostUsd — that specific quote had no measured cost data. Named, never silently folded into the total as if it were priced. */
  requirementsWithoutMeasuredCost: string[];
}

export function quoteBacklog(repoRoot: string, requirementIds: string[], opts: QuoteOptions = {}): BacklogQuote {
  const requirementQuotes: Quote[] = [];
  const skippedRequirements: { requirementId: string; reason: string }[] = [];

  for (const id of requirementIds) {
    const result = quoteRequirement(repoRoot, id, opts);
    if (result.ok) {
      requirementQuotes.push(result.quote);
    } else {
      skippedRequirements.push({ requirementId: id, reason: result.reason });
    }
  }

  const pricedQuotes = requirementQuotes.filter((q) => q.lowCostUsd !== undefined);
  const requirementsWithoutMeasuredCost = requirementQuotes.filter((q) => q.lowCostUsd === undefined).map((q) => q.requirementId);
  const lowCostUsd = pricedQuotes.length > 0 ? pricedQuotes.reduce((sum, q) => sum + (q.lowCostUsd ?? 0), 0) : undefined;
  const highCostUsd = pricedQuotes.length > 0 ? pricedQuotes.reduce((sum, q) => sum + (q.highCostUsd ?? 0), 0) : undefined;

  const lowTokens = requirementQuotes.reduce((sum, q) => sum + q.lowTokens, 0);
  const highTokens = requirementQuotes.reduce((sum, q) => sum + q.highTokens, 0);
  const confidence = requirementQuotes.length > 0 ? Math.min(...requirementQuotes.map((q) => q.confidence)) : 0;

  return { lowTokens, highTokens, lowCostUsd, highCostUsd, confidence, requirementQuotes, skippedRequirements, requirementsWithoutMeasuredCost };
}

/** Every requirement id currently on disk — the `--backlog` default (quote everything) before any filter is applied. */
export function listAllRequirementIds(repoRoot: string): string[] {
  const dir = join(repoRoot, 'docs', 'requirements');
  return readRecords<string>(dir, (frontmatter) => (typeof frontmatter.id === 'string' ? frontmatter.id : undefined));
}
