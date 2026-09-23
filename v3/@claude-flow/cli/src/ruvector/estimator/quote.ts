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
 * Pricing reuses model-prices.ts's existing `blendedPrice()`. predict.ts
 * (T10) returns one combined input+output token total per range edge —
 * `complexity` is the only dimension it tracks (its own module doc) —
 * so there is no real per-task input/output split to price with
 * `costUsd()` directly. `blendedPrice(modelId)` already IS this repo's
 * stated "no real split, use the KRR trainer's 1x-input + 3x-output mix"
 * assumption; reusing it means `quote`'s price is one Mtok-rate away
 * from a raw token count: `tokens * blendedPrice(modelId) / 4_000_000`
 * (blendedPrice = 1×p.in + 3×p.out per Mtok, i.e. the $ for 4 "mix
 * units" of that ratio). A stated assumption, not a measured split —
 * named in the output per this task's own acceptance criterion.
 *
 * @module estimator/quote
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseRecordFile, validateRecord, type Task, type Requirement } from '@claude-flow/docops';
import { extractFeatures } from './features.js';
import { predictTokens, type EstimatorRow } from './predict.js';
import { loadCalibrationRows, loadEstimatorCorpus, buildUnifiedCorpus } from './corpus.js';
import { blendedPrice } from '../model-prices.js';

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
  lowCostUsd: number;
  highCostUsd: number;
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
  const rate = blendedPrice(priceId); // throws UnknownModelPriceError on a bad --price-id — same fail-loud contract as costUsd

  const perTask: TaskQuote[] = [];
  const unpredictedTasks: UnpredictedTask[] = [];
  let lowTokens = 0;
  let highTokens = 0;
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
    perTask.push({ taskId: task.id, title: task.title, lowTokens: estimate.lowTokens, highTokens: estimate.highTokens, confidence: estimate.confidence });
  }

  if (perTask.length === 0) {
    return {
      ok: false,
      reason: `${tasks.length} task(s) cite ${requirementId} but none could be estimated (${unpredictedTasks.map((u) => u.taskId).join(', ')}) — corpus too thin`,
    };
  }

  const confidence = Math.min(...perTask.map((t) => t.confidence));

  return {
    ok: true,
    quote: {
      requirementId,
      requirementTitle: requirement.title,
      lowTokens,
      highTokens,
      lowCostUsd: (lowTokens * rate) / 4_000_000,
      highCostUsd: (highTokens * rate) / 4_000_000,
      confidence,
      taskCount: tasks.length,
      perTask,
      unpredictedTasks,
      assumptions: {
        retryMultiplier,
        corpusSize: corpus.length,
        neighborCount,
        priceId,
        pricingModel: 'blended 1x-input + 3x-output rate (model-prices.ts blendedPrice) — no real per-task input/output split available from predict.ts',
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
  lowCostUsd: number;
  highCostUsd: number;
  confidence: number;
  requirementQuotes: Quote[];
  skippedRequirements: { requirementId: string; reason: string }[];
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

  const lowTokens = requirementQuotes.reduce((sum, q) => sum + q.lowTokens, 0);
  const highTokens = requirementQuotes.reduce((sum, q) => sum + q.highTokens, 0);
  const lowCostUsd = requirementQuotes.reduce((sum, q) => sum + q.lowCostUsd, 0);
  const highCostUsd = requirementQuotes.reduce((sum, q) => sum + q.highCostUsd, 0);
  const confidence = requirementQuotes.length > 0 ? Math.min(...requirementQuotes.map((q) => q.confidence)) : 0;

  return { lowTokens, highTokens, lowCostUsd, highCostUsd, confidence, requirementQuotes, skippedRequirements };
}

/** Every requirement id currently on disk — the `--backlog` default (quote everything) before any filter is applied. */
export function listAllRequirementIds(repoRoot: string): string[] {
  const dir = join(repoRoot, 'docs', 'requirements');
  return readRecords<string>(dir, (frontmatter) => (typeof frontmatter.id === 'string' ? frontmatter.id : undefined));
}
