/**
 * T11/TASK-023 (agentic SDLC plan) — quote.ts's roll-up + pricing logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeContentHash, serializeRecordFile } from '@claude-flow/docops';
import { quoteRequirement, quoteBacklog, listAllRequirementIds } from '../../../src/ruvector/estimator/quote.js';

describe('quote.ts', () => {
  let repoRoot: string;
  let reqDir: string;
  let taskDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'quote-'));
    reqDir = join(repoRoot, 'docs', 'requirements');
    taskDir = join(repoRoot, 'docs', 'tasks');
    mkdirSync(reqDir, { recursive: true });
    mkdirSync(taskDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeRequirement(id: string, title: string, filename = `${id}-x.md`): void {
    const body = `# ${title}\n\nSome requirement body.\n`;
    const frontmatter = {
      id, title, status: 'accepted',
      createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
      citations: [], supersedes: [],
      contentHash: computeContentHash(body), provenance: 'human',
    };
    writeFileSync(join(reqDir, filename), serializeRecordFile(frontmatter, body));
  }

  function writeTask(id: string, title: string, citations: string[], extra: Record<string, unknown> = {}, body = `# ${title}\n\nA plain task body, nothing unusual.\n`): void {
    const frontmatter = {
      id, title, status: 'drafted', priority: 'p2',
      createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
      citations, dependsOn: [],
      contentHash: computeContentHash(body), provenance: 'agent-inferred',
      ...extra,
    };
    writeFileSync(join(taskDir, `${id}-x.md`), serializeRecordFile(frontmatter, body));
  }

  /** A calibration row the estimator can draw neighbours from — cites an unrelated requirement on purpose, matching loadCalibrationRows' real behaviour of scanning EVERY task with actuals, not just ones citing the quoted requirement. */
  function writeCalibrationTask(id: string): void {
    writeTask(id, 'Calibration source task', ['REQ-999'], {
      status: 'done',
      actuals: { inputTokens: 1000, outputTokens: 500, costUsd: 0.01 },
    });
  }

  describe('quoteRequirement', () => {
    it('returns ok:false for an unknown requirement id', () => {
      const result = quoteRequirement(repoRoot, 'REQ-404');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/no requirement record found/);
    });

    it('returns ok:false when no task cites the requirement', () => {
      writeRequirement('REQ-001', 'Add caching');
      const result = quoteRequirement(repoRoot, 'REQ-001');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/no task cites/);
    });

    it('returns ok:false when the corpus is empty — nothing to estimate from', () => {
      writeRequirement('REQ-001', 'Add caching');
      writeTask('TASK-001', 'Implement the cache', ['REQ-001']);
      const result = quoteRequirement(repoRoot, 'REQ-001');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/none could be estimated/);
    });

    it('quotes a requirement from its citing tasks, priced against the model table', () => {
      writeRequirement('REQ-001', 'Add caching');
      writeCalibrationTask('TASK-900');
      writeTask('TASK-001', 'Implement the cache', ['REQ-001']);
      writeTask('TASK-002', 'Write cache tests', ['REQ-001']);

      const result = quoteRequirement(repoRoot, 'REQ-001');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { quote } = result;

      expect(quote.requirementId).toBe('REQ-001');
      expect(quote.requirementTitle).toBe('Add caching');
      expect(quote.taskCount).toBe(2);
      expect(quote.perTask).toHaveLength(2);
      expect(quote.unpredictedTasks).toHaveLength(0);

      // Sum, not an average — see quote.ts's own module doc.
      const expectedLow = quote.perTask.reduce((s, t) => s + t.lowTokens, 0);
      const expectedHigh = quote.perTask.reduce((s, t) => s + t.highTokens, 0);
      expect(quote.lowTokens).toBe(expectedLow);
      expect(quote.highTokens).toBe(expectedHigh);

      // Priced via blendedPrice's 1x-in + 3x-out convention, /4Mtok.
      expect(quote.lowCostUsd).toBeGreaterThan(0);
      expect(quote.highCostUsd).toBeGreaterThanOrEqual(quote.lowCostUsd);

      // MIN across tasks, not a mean.
      expect(quote.confidence).toBe(Math.min(...quote.perTask.map((t) => t.confidence)));

      expect(quote.assumptions.priceId).toBe('sonnet');
      expect(quote.assumptions.corpusSize).toBeGreaterThan(0);
      expect(quote.assumptions.retryMultiplier).toBeCloseTo(1.3);
      expect(quote.assumptions.neighborCount).toBeGreaterThan(0); // T11's own acceptance criterion: name it, don't just imply it
    });

    it('honours a custom priceId and throws (surfaces) on an unknown one', () => {
      writeRequirement('REQ-001', 'Add caching');
      writeCalibrationTask('TASK-900');
      writeTask('TASK-001', 'Implement the cache', ['REQ-001']);

      const cheap = quoteRequirement(repoRoot, 'REQ-001', { priceId: 'haiku' });
      const strong = quoteRequirement(repoRoot, 'REQ-001', { priceId: 'opus' });
      expect(cheap.ok).toBe(true);
      expect(strong.ok).toBe(true);
      if (cheap.ok && strong.ok) {
        // Same token range (same corpus/complexity), different price tier.
        expect(strong.quote.highCostUsd).toBeGreaterThan(cheap.quote.highCostUsd);
      }

      expect(() => quoteRequirement(repoRoot, 'REQ-001', { priceId: 'not-a-real-model' })).toThrow(/No price entry/);
    });

    it('ignores a task not citing the requirement even if it cites others', () => {
      writeRequirement('REQ-001', 'Add caching');
      writeRequirement('REQ-002', 'Add logging');
      writeCalibrationTask('TASK-900');
      writeTask('TASK-001', 'Implement the cache', ['REQ-001']);
      writeTask('TASK-002', 'Implement logging', ['REQ-002']);

      const result = quoteRequirement(repoRoot, 'REQ-001');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.quote.taskCount).toBe(1);
        expect(result.quote.perTask[0].taskId).toBe('TASK-001');
      }
    });
  });

  describe('quoteBacklog', () => {
    it('sums quotable requirements and names skipped ones, never silently dropping them', () => {
      writeRequirement('REQ-001', 'Add caching');
      writeRequirement('REQ-002', 'Add logging');
      writeCalibrationTask('TASK-900');
      writeTask('TASK-001', 'Implement the cache', ['REQ-001']);
      writeTask('TASK-002', 'Implement logging', ['REQ-002']);
      // REQ-003 exists but nothing cites it — should be skipped, not silently omitted.
      writeRequirement('REQ-003', 'Unused requirement');

      const backlog = quoteBacklog(repoRoot, ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-404']);

      expect(backlog.requirementQuotes).toHaveLength(2);
      expect(backlog.skippedRequirements.map((s) => s.requirementId).sort()).toEqual(['REQ-003', 'REQ-404']);

      const expectedLow = backlog.requirementQuotes.reduce((s, q) => s + q.lowTokens, 0);
      const expectedHigh = backlog.requirementQuotes.reduce((s, q) => s + q.highTokens, 0);
      expect(backlog.lowTokens).toBe(expectedLow);
      expect(backlog.highTokens).toBe(expectedHigh);
      expect(backlog.confidence).toBe(Math.min(...backlog.requirementQuotes.map((q) => q.confidence)));
    });

    it('returns an all-zero, zero-confidence result when nothing is quotable', () => {
      const backlog = quoteBacklog(repoRoot, ['REQ-404']);
      expect(backlog.requirementQuotes).toHaveLength(0);
      expect(backlog.skippedRequirements).toHaveLength(1);
      expect(backlog.lowTokens).toBe(0);
      expect(backlog.confidence).toBe(0);
    });
  });

  describe('listAllRequirementIds', () => {
    it('lists every requirement id on disk', () => {
      writeRequirement('REQ-001', 'Add caching');
      writeRequirement('REQ-002', 'Add logging');
      expect(listAllRequirementIds(repoRoot).sort()).toEqual(['REQ-001', 'REQ-002']);
    });

    it('returns [] when docs/requirements/ does not exist', () => {
      rmSync(reqDir, { recursive: true, force: true });
      expect(listAllRequirementIds(repoRoot)).toEqual([]);
    });
  });
});
