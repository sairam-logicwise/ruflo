/**
 * corpus.ts — training corpus for the token/cost estimator (T7, agentic
 * SDLC plan, tasks/plan.md).
 *
 * The router-trajectory log (`router-trajectory.ts`, opt-in via
 * CLAUDE_FLOW_ROUTER_TRAJECTORY=1) already records, per task: the model
 * routed to, the heuristic complexity score, and — on the paired outcome
 * row — actual input/output tokens and USD cost. Nobody reads it for cost
 * estimation yet; this module is the reader.
 *
 * A row only enters the corpus when it has BOTH a decision and a matching
 * outcome (joined by `task_hash`) AND the outcome carries usable input AND
 * output token counts — a row missing either can't teach the estimator
 * anything trustworthy about cost (review-2026-09-21.md, Important 7: the
 * output side dominates cost at most models' rates, so a zero-output row
 * teaches a wrong, too-cheap association), so it's excluded and counted
 * rather than silently kept as a zero (same reasoning as T12's pricing
 * fix: an honest, smaller corpus over a padded, misleading one).
 *
 * @module estimator/corpus
 */

import { readFileSync } from 'node:fs';
import type {
  TrajectoryDecisionRow,
  TrajectoryOutcomeRow,
  TrajectoryRow,
} from '../router-trajectory.js';

/** One labelled example: a task the router routed, and what it actually cost. */
export interface CorpusRow {
  task: string;
  complexity: number;
  /** Concrete model id when the outcome recorded one, else the tier label. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  /** ISO timestamp of the outcome — lets a consumer weight recent rows higher. */
  ts: string;
}

/**
 * Every count here is in raw (pre-dedup) rows except where noted, and the
 * accounting is meant to balance (review-2026-09-21.md, Important 6):
 *
 *   decisions === corpusSize + excludedNoMatch + excludedNoTokens + duplicateDecisions
 *   outcomes  === corpusSize + excludedNoTokens + duplicateOutcomes + orphanOutcomes
 *
 * ("latest wins" join: a repeated task_hash across multiple decision or
 * outcome rows collapses to one, and everything superseded that way is
 * `duplicate*` — not lost, not miscounted as excluded for a content reason.)
 */
export interface CorpusStats {
  totalLines: number;
  malformedLines: number;
  /** Raw decision rows seen, before "latest wins" dedup by task_hash. */
  decisions: number;
  /** Raw outcome rows seen, before "latest wins" dedup by task_hash. */
  outcomes: number;
  /** Decision rows superseded by a newer decision row with the same task_hash. */
  duplicateDecisions: number;
  /** Outcome rows superseded by a newer outcome row with the same task_hash. */
  duplicateOutcomes: number;
  /** Deduplicated decisions with no matching outcome row at all. */
  excludedNoMatch: number;
  /** Matched pairs whose outcome carried no usable input+output token counts. */
  excludedNoTokens: number;
  /** Deduplicated outcomes that never matched any decision (the reverse of excludedNoMatch). */
  orphanOutcomes: number;
  corpusSize: number;
  dateRange: { earliest: string; latest: string } | null;
}

export interface CorpusResult {
  rows: CorpusRow[];
  stats: CorpusStats;
}

function emptyStats(totalLines = 0): CorpusStats {
  return {
    totalLines,
    malformedLines: 0,
    decisions: 0,
    outcomes: 0,
    duplicateDecisions: 0,
    duplicateOutcomes: 0,
    excludedNoMatch: 0,
    excludedNoTokens: 0,
    orphanOutcomes: 0,
    corpusSize: 0,
    dateRange: null,
  };
}

/**
 * Shape-check beyond the `type` tag (review-2026-09-21.md, Important 8):
 * `{"type":"decision"}` alone used to count as well-formed and entered the
 * corpus with `undefined` task/complexity/model. Checks only the fields
 * this module actually reads — not a full schema validator, just enough
 * that a row missing what buildEstimatorCorpus needs is caught as
 * malformed rather than silently producing a broken CorpusRow.
 */
function isWellFormedRow(parsed: unknown): parsed is TrajectoryRow {
  if (!parsed || typeof parsed !== 'object') return false;
  const row = parsed as Record<string, unknown>;
  if (typeof row.task_hash !== 'string' || typeof row.ts !== 'string') return false;
  if (row.type === 'decision') {
    return typeof row.task === 'string' && typeof row.complexity === 'number' && typeof row.model === 'string';
  }
  if (row.type === 'outcome') {
    return true; // tokens/cost_usd/model_id are all optional on an outcome row
  }
  return false;
}

/**
 * Parse + pair a raw JSONL trajectory log into estimator training rows.
 * Tolerant of malformed lines (bad JSON, or valid JSON that isn't a
 * well-formed decision/outcome row) — each is counted, not thrown.
 */
export function buildEstimatorCorpus(logText: string): CorpusResult {
  const lines = logText.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], stats: emptyStats(0) };

  const rows: TrajectoryRow[] = [];
  let malformedLines = 0;
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isWellFormedRow(parsed)) {
        rows.push(parsed);
      } else {
        malformedLines++;
      }
    } catch {
      malformedLines++;
    }
  }

  // Latest-wins per hash, same join convention as pairTrajectoryRows() in
  // router-trajectory.ts — production may re-run the same task, and the
  // most recent outcome is the one worth learning from.
  const decisions = new Map<string, TrajectoryDecisionRow>();
  const outcomes = new Map<string, TrajectoryOutcomeRow>();
  let dCount = 0;
  let oCount = 0;
  for (const row of rows) {
    if (row.type === 'decision') {
      dCount++;
      const prev = decisions.get(row.task_hash);
      if (!prev || row.ts > prev.ts) decisions.set(row.task_hash, row);
    } else {
      oCount++;
      const prev = outcomes.get(row.task_hash);
      if (!prev || row.ts > prev.ts) outcomes.set(row.task_hash, row);
    }
  }
  const duplicateDecisions = dCount - decisions.size;
  const duplicateOutcomes = oCount - outcomes.size;

  const corpusRows: CorpusRow[] = [];
  let excludedNoMatch = 0;
  let excludedNoTokens = 0;
  const matchedOutcomeHashes = new Set<string>();
  for (const [hash, dec] of decisions) {
    const out = outcomes.get(hash);
    if (!out) { excludedNoMatch++; continue; }
    matchedOutcomeHashes.add(hash);

    const inputTokens = out.tokens?.input ?? 0;
    const outputTokens = out.tokens?.output ?? 0;
    // Both sides required (Important 7) — a row missing either teaches a
    // wrong cost association, not just an incomplete one.
    if (inputTokens <= 0 || outputTokens <= 0) { excludedNoTokens++; continue; }

    corpusRows.push({
      task: dec.task,
      complexity: dec.complexity,
      model: out.model_id ?? dec.model,
      inputTokens,
      outputTokens,
      ...(out.cost_usd != null ? { costUsd: out.cost_usd } : {}),
      ts: out.ts,
    });
  }
  const orphanOutcomes = outcomes.size - matchedOutcomeHashes.size;

  const timestamps = corpusRows.map((r) => r.ts).sort();
  const dateRange = timestamps.length > 0
    ? { earliest: timestamps[0], latest: timestamps[timestamps.length - 1] }
    : null;

  return {
    rows: corpusRows,
    stats: {
      totalLines: lines.length,
      malformedLines,
      decisions: dCount,
      outcomes: oCount,
      duplicateDecisions,
      duplicateOutcomes,
      excludedNoMatch,
      excludedNoTokens,
      orphanOutcomes,
      corpusSize: corpusRows.length,
      dateRange,
    },
  };
}

/**
 * Read the trajectory log at `path` and build the corpus. A missing file
 * (trajectory recording has never been enabled) is not an error — it's an
 * empty corpus, reported as such.
 */
export function loadEstimatorCorpus(path: string): CorpusResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { rows: [], stats: emptyStats(0) };
  }
  return buildEstimatorCorpus(text);
}
