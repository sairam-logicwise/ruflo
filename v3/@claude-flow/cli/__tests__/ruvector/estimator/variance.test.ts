/**
 * T14/TASK-019 (agentic SDLC plan) — quoted-versus-actual hit rate and
 * trend, against fixture task records with known estimate/actual pairs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeContentHash, serializeRecordFile } from '@claude-flow/docops';
import { buildVarianceReport } from '../../../src/ruvector/estimator/variance.js';

describe('variance.ts', () => {
  let repoRoot: string;
  let taskDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'variance-'));
    taskDir = join(repoRoot, 'docs', 'tasks');
    mkdirSync(taskDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeTask(id: string, opts: {
    title?: string;
    createdAt?: string;
    estimate?: { lowTokens: number; highTokens: number; confidence: number };
    // 'measured' by default — most of these tests are about hit/miss and
    // trend logic, not the proxy-vs-measured caveat (which has its own
    // dedicated tests below).
    actuals?: { inputTokens: number; outputTokens: number; costUsd: number; source?: 'proxy' | 'measured' };
  } = {}): void {
    const title = opts.title ?? `Task ${id}`;
    const body = `# ${title}\n\nA plain task body.\n`;
    const createdAt = opts.createdAt ?? '2026-09-23T00:00:00.000Z';
    const frontmatter: Record<string, unknown> = {
      id, title, status: 'done', priority: 'p2',
      createdAt, updatedAt: createdAt,
      citations: ['REQ-999'], dependsOn: [],
      contentHash: computeContentHash(body), provenance: 'agent-inferred',
      ...(opts.estimate ? { estimate: opts.estimate } : {}),
      ...(opts.actuals ? { actuals: { source: 'measured', priceModel: 'anthropic/claude-sonnet-4-6', ...opts.actuals } } : {}),
    };
    writeFileSync(join(taskDir, `${id}-x.md`), serializeRecordFile(frontmatter, body));
  }

  it('returns an empty, zero (not NaN) report when docs/tasks/ has nothing', () => {
    const report = buildVarianceReport(repoRoot);
    expect(report.sampleSize).toBe(0);
    expect(report.hitRate).toBe(0);
    expect(report.perTask).toEqual([]);
    expect(report.trend).toEqual([]);
  });

  it('marks a task whose actual falls inside its quoted range as a hit', () => {
    writeTask('TASK-001', {
      estimate: { lowTokens: 800, highTokens: 1200, confidence: 0.5 },
      actuals: { inputTokens: 700, outputTokens: 300, costUsd: 0.01 }, // total 1000, inside [800,1200]
    });
    const report = buildVarianceReport(repoRoot);
    expect(report.sampleSize).toBe(1);
    expect(report.perTask[0].hit).toBe(true);
    expect(report.perTask[0].actualTokens).toBe(1000);
    expect(report.hitRate).toBe(1);
  });

  it('marks a task whose actual falls outside its quoted range as a miss', () => {
    writeTask('TASK-001', {
      estimate: { lowTokens: 800, highTokens: 1200, confidence: 0.5 },
      actuals: { inputTokens: 1800, outputTokens: 300, costUsd: 0.02 }, // total 2100, outside [800,1200]
    });
    const report = buildVarianceReport(repoRoot);
    expect(report.perTask[0].hit).toBe(false);
    expect(report.hitRate).toBe(0);
  });

  it('treats the estimate boundary as inclusive on both ends', () => {
    writeTask('TASK-001', {
      estimate: { lowTokens: 1000, highTokens: 1000, confidence: 0.5 },
      actuals: { inputTokens: 1000, outputTokens: 0, costUsd: 0.01 },
    });
    expect(buildVarianceReport(repoRoot).perTask[0].hit).toBe(true);
  });

  it('skips and names a task missing actuals, without dropping it silently', () => {
    writeTask('TASK-001', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 } });
    const report = buildVarianceReport(repoRoot);
    expect(report.perTask).toHaveLength(0);
    expect(report.skipped).toEqual([{ taskId: 'TASK-001', title: 'Task TASK-001', reason: 'no actuals recorded' }]);
  });

  it('skips and names a task missing an estimate', () => {
    writeTask('TASK-001', { actuals: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 } });
    const report = buildVarianceReport(repoRoot);
    expect(report.skipped).toEqual([{ taskId: 'TASK-001', title: 'Task TASK-001', reason: 'no estimate recorded' }]);
  });

  it('skips and names a task missing both, combined into one reason', () => {
    writeTask('TASK-001');
    const report = buildVarianceReport(repoRoot);
    expect(report.skipped[0].reason).toBe('no estimate and actuals recorded');
  });

  // Review #3, C5: the caveat and the measured-only alternative number.
  describe('proxy-vs-measured caveat (C5)', () => {
    it('sets no caveat, and reports the full hit rate as the measured rate too, when every row is measured', () => {
      writeTask('TASK-001', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001, source: 'measured' } });
      const report = buildVarianceReport(repoRoot);
      expect(report.hitRateCaveat).toBeUndefined();
      expect(report.measuredSampleSize).toBe(1);
      expect(report.measuredHitRate).toBe(report.hitRate);
    });

    it('sets a strong caveat naming the real hold-out figure when EVERY row is proxy-only', () => {
      writeTask('TASK-001', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001, source: 'proxy' } });
      writeTask('TASK-002', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001, source: 'proxy' } });
      const report = buildVarianceReport(repoRoot);
      expect(report.hitRateCaveat).toMatch(/all 2 task\(s\)/);
      expect(report.hitRateCaveat).toMatch(/75\.0%/); // points at the real hold-out figure, not just "be careful"
      expect(report.measuredSampleSize).toBe(0);
      expect(report.measuredHitRate).toBe(0); // an honest zero, not a fabricated number
    });

    it('sets a proportional caveat and a real measured-only rate when the sample is mixed', () => {
      writeTask('TASK-001', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001, source: 'measured' } }); // hit, measured
      writeTask('TASK-002', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 500, outputTokens: 0, costUsd: 0.001, source: 'measured' } }); // miss, measured
      writeTask('TASK-003', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001, source: 'proxy' } }); // hit, proxy
      const report = buildVarianceReport(repoRoot);
      expect(report.hitRateCaveat).toMatch(/1 of 3 task\(s\)/);
      expect(report.measuredSampleSize).toBe(2);
      expect(report.measuredHitRate).toBeCloseTo(0.5); // 1 hit / 2 measured — the proxy hit is excluded
      expect(report.hitRate).toBeCloseTo(2 / 3); // the (caveated) headline still counts all 3
    });
  });

  it('computes the aggregate hit rate across a mix of hits and misses', () => {
    writeTask('TASK-001', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001 } }); // hit
    writeTask('TASK-002', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 500, outputTokens: 0, costUsd: 0.001 } }); // miss
    writeTask('TASK-003', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 180, outputTokens: 0, costUsd: 0.001 } }); // hit
    const report = buildVarianceReport(repoRoot);
    expect(report.sampleSize).toBe(3);
    expect(report.hitRate).toBeCloseTo(2 / 3);
  });

  it('orders the trend chronologically by createdAt, independent of file/read order, with a real cumulative hit rate', () => {
    // Written out of chronological order on purpose.
    writeTask('TASK-003', { createdAt: '2026-09-23T00:00:03.000Z', estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 500, outputTokens: 0, costUsd: 0.001 } }); // miss
    writeTask('TASK-001', { createdAt: '2026-09-23T00:00:01.000Z', estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001 } }); // hit
    writeTask('TASK-002', { createdAt: '2026-09-23T00:00:02.000Z', estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001 } }); // hit

    const report = buildVarianceReport(repoRoot);
    expect(report.trend.map((t) => t.taskId)).toEqual(['TASK-001', 'TASK-002', 'TASK-003']);
    expect(report.trend[0]).toMatchObject({ hit: true, cumulativeSampleSize: 1, cumulativeHitRate: 1 });
    expect(report.trend[1]).toMatchObject({ hit: true, cumulativeSampleSize: 2, cumulativeHitRate: 1 });
    expect(report.trend[2]).toMatchObject({ hit: false, cumulativeSampleSize: 3 });
    expect(report.trend[2].cumulativeHitRate).toBeCloseTo(2 / 3);
  });

  it('a single early task reads as a small sample, not a false 100%/0% trend', () => {
    writeTask('TASK-001', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001 } });
    const report = buildVarianceReport(repoRoot);
    expect(report.trend).toHaveLength(1);
    expect(report.trend[0].cumulativeSampleSize).toBe(1); // the sample size travels with the rate, not hidden
  });

  it('skips a task that fails to validate, without crashing the rest of the scan', () => {
    writeFileSync(join(taskDir, 'TASK-999-broken.md'), '---\nid: TASK-999\nstatus: not-a-real-status\n---\n\nbroken\n');
    writeTask('TASK-001', { estimate: { lowTokens: 100, highTokens: 200, confidence: 0.5 }, actuals: { inputTokens: 150, outputTokens: 0, costUsd: 0.001 } });
    const report = buildVarianceReport(repoRoot);
    expect(report.sampleSize).toBe(1);
  });
});
