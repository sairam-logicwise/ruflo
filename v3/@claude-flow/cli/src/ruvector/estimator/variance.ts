/**
 * variance.ts — quoted versus actual, per task and in aggregate (T14,
 * agentic SDLC plan, tasks/plan.md). Built from T6's own real
 * decomposition of REQ-003 (TASK-029/030/031) as the literal
 * implementation plan.
 *
 * Compares a task record's OWN `estimate` field against its OWN
 * `actuals` field — never re-derives a quote via T10's `predictTokens()`.
 * This is deliberate: variance measures whether the estimate a task
 * actually SHIPPED with held up, whatever produced that estimate (T10's
 * estimator, a human, or — today, this repo's only real fixture data —
 * T8's synthetic "±20% of the real actuals" calibration-pilot band). A
 * task missing either field is skipped and counted, never silently
 * dropped (TASK-029's own acceptance criterion) — the same "name what
 * was excluded" discipline `quote.ts`'s `unpredictedTasks` already
 * applies.
 *
 * IMPORTANT, discovered running this for real against this repo's own
 * calibration set (TASK-019's own verification step): T8's 16 calibration
 * records' `estimate` field is `[0.8x, 1.2x]` of their OWN `actuals` —
 * computed directly FROM the actuals, before T10's estimator even
 * existed. Comparing that estimate to those same actuals is tautological
 * (the actual is inside its own ±20% band by construction) and reports
 * 100% — it is NOT a measurement of T10's real predictive accuracy, and
 * does NOT match `estimator-holdout-check.mjs`'s real 75.0% hold-out
 * figure (a completely different computation: leave-one-out nearest-
 * neighbour prediction, never using a task's own recorded estimate at
 * all). Nothing in this codebase currently writes a task's `estimate`
 * field FROM `predictTokens()` — until something does, this report's
 * hit rate on THIS repo's records measures self-consistency of T8's
 * synthetic band, not estimator accuracy. Reported plainly, not
 * papered over — see the CLI's own `--json` output and plan.md's T14
 * Done note.
 *
 * @module estimator/variance
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseRecordFile, validateRecord, type Task } from '@claude-flow/docops';

export interface TaskVariance {
  taskId: string;
  title: string;
  lowTokens: number;
  highTokens: number;
  actualTokens: number;
  actualCostUsd: number;
  hit: boolean;
  createdAt: string;
}

export interface SkippedTask {
  taskId: string;
  title: string;
  reason: string;
}

/** One task, in chronological order, with the hit rate over every task up to and including it — "improving as the set grows" (TASK-031), not a bucket average that hides how thin an early sample is. */
export interface TrendPoint {
  taskId: string;
  createdAt: string;
  hit: boolean;
  cumulativeSampleSize: number;
  cumulativeHitRate: number;
}

export interface VarianceReport {
  perTask: TaskVariance[];
  skipped: SkippedTask[];
  sampleSize: number;
  /** Hits / sampleSize. 0 (not NaN) when sampleSize is 0 — see buildVarianceReport's own doc. */
  hitRate: number;
  trend: TrendPoint[];
}

function loadAllTasks(repoRoot: string): Task[] {
  const dir = join(repoRoot, 'docs', 'tasks');
  if (!existsSync(dir)) return [];
  const tasks: Task[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    const { frontmatter, body, parseError } = parseRecordFile(raw);
    if (parseError) continue;
    const validated = validateRecord(frontmatter, body);
    if (validated.success) tasks.push(validated.record as Task);
  }
  return tasks;
}

/**
 * Builds the variance report from every real task record under
 * `docs/tasks/`. `hitRate` is `0`, not `NaN`, on an empty/all-skipped
 * corpus — same "an honest zero, not an undefined" convention as the
 * rest of this codebase's estimator work.
 */
export function buildVarianceReport(repoRoot: string): VarianceReport {
  const perTask: TaskVariance[] = [];
  const skipped: SkippedTask[] = [];

  for (const task of loadAllTasks(repoRoot)) {
    if (!task.estimate || !task.actuals) {
      const missing = [!task.estimate ? 'estimate' : null, !task.actuals ? 'actuals' : null].filter(Boolean);
      skipped.push({ taskId: task.id, title: task.title, reason: `no ${missing.join(' and ')} recorded` });
      continue;
    }
    const actualTokens = task.actuals.inputTokens + task.actuals.outputTokens;
    perTask.push({
      taskId: task.id,
      title: task.title,
      lowTokens: task.estimate.lowTokens,
      highTokens: task.estimate.highTokens,
      actualTokens,
      actualCostUsd: task.actuals.costUsd,
      hit: actualTokens >= task.estimate.lowTokens && actualTokens <= task.estimate.highTokens,
      createdAt: task.createdAt,
    });
  }

  const sampleSize = perTask.length;
  const hits = perTask.filter((t) => t.hit).length;
  const hitRate = sampleSize > 0 ? hits / sampleSize : 0;

  const chronological = [...perTask].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let cumulativeHits = 0;
  const trend: TrendPoint[] = chronological.map((t, i) => {
    if (t.hit) cumulativeHits++;
    const cumulativeSampleSize = i + 1;
    return { taskId: t.taskId, createdAt: t.createdAt, hit: t.hit, cumulativeSampleSize, cumulativeHitRate: cumulativeHits / cumulativeSampleSize };
  });

  return { perTask, skipped, sampleSize, hitRate, trend };
}
