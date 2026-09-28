/**
 * T7 (agentic SDLC plan) — estimator training corpus builder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEstimatorCorpus, loadEstimatorCorpus, loadCalibrationRows, buildUnifiedCorpus, type CorpusRow } from '../../../src/ruvector/estimator/corpus.js';
import { computeContentHash, serializeRecordFile } from '@claude-flow/docops';

function decision(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    v: 1, type: 'decision', ts: '2026-06-01T00:00:00.000Z',
    task_hash: 'aaaaaaaa', task: 'remove console.log calls',
    complexity: 0.15, model: 'haiku', confidence: 0.9, uncertainty: 0.1,
    routed_by: 'heuristic',
    ...overrides,
  });
}

function outcome(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    v: 1, type: 'outcome', ts: '2026-06-01T00:00:05.000Z',
    task_hash: 'aaaaaaaa', quality: 1.0,
    tokens: { input: 1200, output: 300 }, cost_usd: 0.0027, model_id: 'anthropic/claude-haiku-4.5',
    ...overrides,
  });
}

describe('buildEstimatorCorpus', () => {
  it('pairs a decision+outcome by task_hash into one corpus row', () => {
    const log = [decision(), outcome()].join('\n');
    const { rows, stats } = buildEstimatorCorpus(log);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task: 'remove console.log calls',
      complexity: 0.15,
      model: 'anthropic/claude-haiku-4.5', // prefers outcome.model_id over the tier label
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.0027,
    });
    expect(stats.corpusSize).toBe(1);
    expect(stats.excludedNoMatch).toBe(0);
    expect(stats.excludedNoTokens).toBe(0);
  });

  it('falls back to the tier label when the outcome has no concrete model_id', () => {
    const log = [decision(), outcome({ model_id: undefined })].join('\n');
    const { rows } = buildEstimatorCorpus(log);
    expect(rows[0].model).toBe('haiku');
  });

  it('excludes and counts decisions with no matching outcome', () => {
    const log = [decision({ task_hash: 'bbbbbbbb' })].join('\n');
    const { rows, stats } = buildEstimatorCorpus(log);
    expect(rows).toHaveLength(0);
    expect(stats.decisions).toBe(1);
    expect(stats.excludedNoMatch).toBe(1);
  });

  it('excludes and counts pairs whose outcome has zero/missing tokens on both sides', () => {
    const log = [
      decision({ task_hash: 'cccccccc' }),
      outcome({ task_hash: 'cccccccc', tokens: { input: 0, output: 0 } }),
      decision({ task_hash: 'dddddddd' }),
      outcome({ task_hash: 'dddddddd', tokens: undefined }),
    ].join('\n');
    const { rows, stats } = buildEstimatorCorpus(log);
    expect(rows).toHaveLength(0);
    expect(stats.excludedNoTokens).toBe(2);
  });

  it('excludes a row with input tokens but zero output (Important 7, review-2026-09-21.md)', () => {
    // Output dominates cost at most models' rates (blendedPrice's own
    // 1x-input + 3x-output convention) — a zero-output row would teach
    // the estimator a wrong, too-cheap association for that complexity.
    const log = [
      decision({ task_hash: 'eeeeeeee' }),
      outcome({ task_hash: 'eeeeeeee', tokens: { input: 5000, output: 0 } }),
    ].join('\n');
    const { rows, stats } = buildEstimatorCorpus(log);
    expect(rows).toHaveLength(0);
    expect(stats.excludedNoTokens).toBe(1);
  });

  it('excludes a row with output tokens but zero input, symmetrically', () => {
    const log = [
      decision({ task_hash: 'ffffffff' }),
      outcome({ task_hash: 'ffffffff', tokens: { input: 0, output: 500 } }),
    ].join('\n');
    const { rows, stats } = buildEstimatorCorpus(log);
    expect(rows).toHaveLength(0);
    expect(stats.excludedNoTokens).toBe(1);
  });

  it('tolerates malformed lines (bad JSON and valid-JSON-but-wrong-shape), counts them', () => {
    const log = [
      decision(),
      outcome(),
      'not json at all {{{',
      JSON.stringify({ some: 'unrelated object' }),
      '',
      '   ',
    ].join('\n');
    const { rows, stats } = buildEstimatorCorpus(log);
    expect(rows).toHaveLength(1);
    expect(stats.malformedLines).toBe(2);
    // blank/whitespace-only lines are filtered before counting, not malformed
    expect(stats.totalLines).toBe(4);
  });

  it('reports corpus size and date range across multiple pairs', () => {
    const log = [
      decision({ task_hash: '11111111', task: 'task one' }),
      outcome({ task_hash: '11111111', ts: '2026-05-01T00:00:00.000Z' }),
      decision({ task_hash: '22222222', task: 'task two' }),
      outcome({ task_hash: '22222222', ts: '2026-07-15T00:00:00.000Z' }),
    ].join('\n');
    const { stats } = buildEstimatorCorpus(log);
    expect(stats.corpusSize).toBe(2);
    expect(stats.dateRange).toEqual({
      earliest: '2026-05-01T00:00:00.000Z',
      latest: '2026-07-15T00:00:00.000Z',
    });
  });

  it('latest decision/outcome wins when the same task_hash repeats', () => {
    const log = [
      decision({ complexity: 0.1, ts: '2026-06-01T00:00:00.000Z' }),
      decision({ complexity: 0.9, ts: '2026-06-02T00:00:00.000Z' }),
      outcome({ tokens: { input: 100, output: 50 }, ts: '2026-06-01T00:00:05.000Z' }),
      outcome({ tokens: { input: 9000, output: 9000 }, ts: '2026-06-02T00:00:05.000Z' }),
    ].join('\n');
    const { rows } = buildEstimatorCorpus(log);
    expect(rows).toHaveLength(1);
    expect(rows[0].complexity).toBe(0.9);
    expect(rows[0].inputTokens).toBe(9000);
  });

  it('rejects a type-tagged row missing the fields this module actually needs (Important 8)', () => {
    // {"type":"decision"} alone used to count as well-formed and enter the
    // corpus with task/complexity/model all undefined.
    const log = [
      JSON.stringify({ type: 'decision', task_hash: 'gggggggg' }), // no task/complexity/model
      decision({ task_hash: 'hhhhhhhh' }),
      outcome({ task_hash: 'hhhhhhhh' }),
    ].join('\n');
    const { rows, stats } = buildEstimatorCorpus(log);
    expect(rows).toHaveLength(1); // only the well-formed pair
    expect(rows.every((r) => r.task !== undefined && r.complexity !== undefined && r.model !== undefined)).toBe(true);
    expect(stats.malformedLines).toBe(1);
  });

  it('an outcome row needs at least task_hash and ts, but tokens/cost_usd/model_id stay optional', () => {
    const log = [
      JSON.stringify({ type: 'outcome' }), // no task_hash at all — malformed
      decision({ task_hash: 'iiiiiiii' }),
      outcome({ task_hash: 'iiiiiiii', tokens: undefined, cost_usd: undefined, model_id: undefined }),
    ].join('\n');
    const { stats } = buildEstimatorCorpus(log);
    expect(stats.malformedLines).toBe(1);
    // the second outcome is well-formed (task_hash + ts present) even
    // though every optional field is absent — it's excluded for having no
    // usable tokens, not rejected as malformed.
    expect(stats.excludedNoTokens).toBe(1);
  });

  it('accounts for duplicate decisions/outcomes and orphan outcomes (Important 6, review-2026-09-21.md)', () => {
    const log = [
      // Same task_hash, two decision rows — one is a "duplicate" (superseded).
      decision({ task_hash: 'jjjjjjjj', ts: '2026-06-01T00:00:00.000Z' }),
      decision({ task_hash: 'jjjjjjjj', ts: '2026-06-01T00:00:01.000Z' }),
      // Same task_hash, two outcome rows — one is a "duplicate" too.
      outcome({ task_hash: 'jjjjjjjj', ts: '2026-06-01T00:00:02.000Z' }),
      outcome({ task_hash: 'jjjjjjjj', ts: '2026-06-01T00:00:03.000Z' }),
      // An outcome with no matching decision at all — an orphan.
      outcome({ task_hash: 'kkkkkkkk' }),
    ].join('\n');
    const { stats } = buildEstimatorCorpus(log);

    expect(stats.decisions).toBe(2);
    expect(stats.outcomes).toBe(3);
    expect(stats.duplicateDecisions).toBe(1);
    expect(stats.duplicateOutcomes).toBe(1);
    expect(stats.orphanOutcomes).toBe(1);
    expect(stats.corpusSize).toBe(1);
    expect(stats.excludedNoMatch).toBe(0);
    expect(stats.excludedNoTokens).toBe(0);

    // The balance equations from CorpusStats's own doc comment.
    expect(stats.decisions).toBe(
      stats.corpusSize + stats.excludedNoMatch + stats.excludedNoTokens + stats.duplicateDecisions,
    );
    expect(stats.outcomes).toBe(
      stats.corpusSize + stats.excludedNoTokens + stats.duplicateOutcomes + stats.orphanOutcomes,
    );
  });

  it('returns an empty corpus for an empty log', () => {
    const { rows, stats } = buildEstimatorCorpus('');
    expect(rows).toHaveLength(0);
    expect(stats.totalLines).toBe(0);
    expect(stats.dateRange).toBeNull();
  });
});

describe('loadEstimatorCorpus', () => {
  it('reads a real file from disk', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'corpus-'));
    try {
      const path = join(tmp, 'trajectories.jsonl');
      writeFileSync(path, [decision(), outcome()].join('\n') + '\n');
      const { rows, stats } = loadEstimatorCorpus(path);
      expect(rows).toHaveLength(1);
      expect(stats.corpusSize).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns an empty corpus (not a throw) when the log file does not exist', () => {
    const { rows, stats } = loadEstimatorCorpus('/nonexistent/path/does-not-exist.jsonl');
    expect(rows).toHaveLength(0);
    expect(stats.totalLines).toBe(0);
  });
});

/** T10/T8 — reading real task records (T8's calibration set, or any future completed task) into estimator rows. */
describe('loadCalibrationRows', () => {
  let repoRoot: string;
  let tasksDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'calibration-rows-'));
    tasksDir = join(repoRoot, 'docs', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeTaskFile(filename: string, extra: Record<string, unknown>): void {
    const body = '# A task\n\nSimple, short body.\n';
    const fields = {
      id: 'TASK-001',
      title: 'A task',
      status: 'done',
      priority: 'p2',
      createdAt: '2026-09-23T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:00.000Z',
      citations: ['REQ-001'],
      dependsOn: [],
      provenance: 'agent-inferred',
      ...extra,
    };
    const frontmatter = { ...fields, contentHash: computeContentHash(fields, body) };
    writeFileSync(join(tasksDir, filename), serializeRecordFile(frontmatter, body));
  }

  it('returns [] when docs/tasks/ does not exist at all', () => {
    rmSync(tasksDir, { recursive: true, force: true });
    expect(loadCalibrationRows(repoRoot)).toEqual([]);
  });

  it('reads a real task record with actuals into a calibration row', () => {
    writeTaskFile('TASK-001-x.md', { actuals: { inputTokens: 1000, outputTokens: 500, costUsd: 0.01, source: 'measured', priceModel: 'anthropic/claude-sonnet-4-6' } });
    const rows = loadCalibrationRows(repoRoot);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 1000, outputTokens: 500, source: 'calibration', measured: true });
    expect(rows[0].complexity).toBeGreaterThanOrEqual(0);
    expect(rows[0].complexity).toBeLessThanOrEqual(1);
  });

  // Review #3, C3: a calibration row must say whether its cost was really
  // metered or a proxy — quote.ts/variance.ts both refuse to treat a
  // proxy-only corpus as if it measured anything.
  it('carries the real measured/proxy distinction through from actuals.source', () => {
    writeTaskFile('TASK-001-x.md', { actuals: { inputTokens: 1000, outputTokens: 500, costUsd: 0.01, source: 'proxy', priceModel: 'anthropic/claude-sonnet-4-6' } });
    const rows = loadCalibrationRows(repoRoot);
    expect(rows[0].measured).toBe(false);
  });

  it('skips a task record with no actuals — nothing to teach the estimator', () => {
    writeTaskFile('TASK-001-x.md', {});
    expect(loadCalibrationRows(repoRoot)).toEqual([]);
  });

  it('skips a record that does not validate, without crashing the rest of the scan', () => {
    writeFileSync(join(tasksDir, 'TASK-001-broken.md'), '---\nid: TASK-001\nstatus: not-a-real-status\n---\n\nbroken\n');
    writeTaskFile('TASK-002-x.md', { id: 'TASK-002', actuals: { inputTokens: 500, outputTokens: 200, costUsd: 0.005, source: 'proxy', priceModel: 'anthropic/claude-sonnet-4-6' } });
    const rows = loadCalibrationRows(repoRoot);
    expect(rows).toHaveLength(1);
  });
});

describe('buildUnifiedCorpus', () => {
  it('combines trajectory and calibration rows, tagging each by its real source', () => {
    const trajectory: CorpusRow[] = [{ task: 'x', complexity: 0.3, model: 'haiku', inputTokens: 100, outputTokens: 50, ts: '2026-01-01T00:00:00.000Z' }];
    const calibration = [{ complexity: 0.6, inputTokens: 1000, outputTokens: 500, source: 'calibration' as const }];
    const unified = buildUnifiedCorpus(trajectory, calibration);
    expect(unified).toHaveLength(2);
    expect(unified.find((r) => r.source === 'trajectory')).toMatchObject({ complexity: 0.3, inputTokens: 100, outputTokens: 50 });
    expect(unified.find((r) => r.source === 'calibration')).toMatchObject({ complexity: 0.6, inputTokens: 1000, outputTokens: 500 });
  });

  it('handles two empty sources without error', () => {
    expect(buildUnifiedCorpus([], [])).toEqual([]);
  });
});
