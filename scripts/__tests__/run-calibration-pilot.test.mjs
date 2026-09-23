/**
 * run-calibration-pilot.mjs — T8, agentic SDLC plan. Verifies the pilot's
 * budget-stop logic, work-type/size spread, and record-writing at $0 cost
 * via an injected fake LLM call and a fake record writer — no real API
 * call, matching this repo's convention for scripts that spend real money
 * (train-price-guard.mjs, decompose.ts) of keeping the decision/dispatch
 * logic testable in isolation from the actual network call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPilot, PILOT_TASKS, DECISION_ID, DEFAULT_BUDGET_USD, writeTaskRecord } from '../run-calibration-pilot.mjs';
import { validateRecordFile } from '../../v3/@claude-flow/docops/dist/index.js';

/** A fake LLM call whose usage scales with the real prompt it was given, so it respects the same maxTokens ceiling the worst-case budget check assumes — a fixed-size mock would make actual cost exceed the worst-case bound purely as a mock artifact, not a real one. */
function fakeCall(outputFraction = 0.5) {
  return vi.fn(async (input) => ({
    success: true,
    output: 'Proposed fix: ...',
    usage: {
      inputTokens: Math.ceil(input.prompt.length / 4),
      outputTokens: Math.round((input.maxTokens ?? 1024) * outputFraction),
      totalTokens: 0,
    },
  }));
}

function fakeWriter() {
  const written = [];
  const writeRecord = vi.fn((ctx, task, response, actuals) => {
    written.push({ ctx, task, response, actuals });
    return { id: `TASK-${String(written.length).padStart(3, '0')}`, filePath: `/fake/docs/tasks/${task.id}.md` };
  });
  return { writeRecord, written };
}

describe('PILOT_TASKS', () => {
  it('has at least 15 tasks (plan.md T8 acceptance minimum)', () => {
    expect(PILOT_TASKS.length).toBeGreaterThanOrEqual(15);
  });

  it('has at most 20 tasks (plan.md T8 acceptance ceiling)', () => {
    expect(PILOT_TASKS.length).toBeLessThanOrEqual(20);
  });

  it('has no single work type over half the set', () => {
    const byType = new Map();
    for (const t of PILOT_TASKS) byType.set(t.workType, (byType.get(t.workType) ?? 0) + 1);
    for (const [type, count] of byType) {
      expect(count, `work type "${type}"`).toBeLessThanOrEqual(PILOT_TASKS.length / 2);
    }
  });

  it('spans more than one size and more than one work type', () => {
    expect(new Set(PILOT_TASKS.map((t) => t.size)).size).toBeGreaterThan(1);
    expect(new Set(PILOT_TASKS.map((t) => t.workType)).size).toBeGreaterThan(1);
  });

  it('every task has a unique id, real context files, and a non-trivial instruction', () => {
    const ids = new Set();
    for (const t of PILOT_TASKS) {
      expect(ids.has(t.id), `duplicate id ${t.id}`).toBe(false);
      ids.add(t.id);
      expect(t.contextFiles.length).toBeGreaterThan(0);
      expect(t.instructions.length).toBeGreaterThan(40);
      expect(['small', 'medium', 'large']).toContain(t.size);
      expect(['haiku', 'sonnet', 'opus']).toContain(t.tier);
    }
  });
});

describe('runPilot — dry run (default)', () => {
  it('calls nothing and writes nothing by default', async () => {
    const callLLM = fakeCall();
    const { writeRecord, written } = fakeWriter();
    const result = await runPilot({ tasks: PILOT_TASKS.slice(0, 3), callLLM, writeRecord });
    expect(callLLM).not.toHaveBeenCalled();
    expect(written).toHaveLength(0);
    expect(result.spentUsd).toBe(0);
    expect(result.results.every((r) => r.status === 'dry-run')).toBe(true);
  });
});

describe('runPilot — real run (mocked LLM)', () => {
  it('writes a task record per successful call, citing the decision, with real actuals populated', async () => {
    const callLLM = fakeCall();
    const { writeRecord, written } = fakeWriter();
    const result = await runPilot({ tasks: PILOT_TASKS.slice(0, 2), dryRun: false, callLLM, writeRecord });

    expect(result.results.filter((r) => r.status === 'created')).toHaveLength(2);
    expect(written).toHaveLength(2);
    for (const w of written) {
      expect(w.ctx.decisionId).toBe(DECISION_ID);
      expect(w.actuals.inputTokens).toBeGreaterThan(0);
      expect(w.actuals.outputTokens).toBeGreaterThan(0);
      expect(w.actuals.costUsd).toBeGreaterThan(0);
    }
  });

  it('prices a haiku task cheaper than a sonnet task for comparable token counts', async () => {
    const haikuTask = PILOT_TASKS.find((t) => t.tier === 'haiku');
    const sonnetTask = PILOT_TASKS.find((t) => t.tier === 'sonnet');
    const callLLM = vi.fn(async () => ({
      success: true,
      output: 'x',
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    }));
    const { writeRecord, written } = fakeWriter();
    await runPilot({ tasks: [haikuTask, sonnetTask], dryRun: false, callLLM, writeRecord });
    expect(written[0].actuals.costUsd).toBeLessThan(written[1].actuals.costUsd);
  });

  it('never lets a completed task push actual spend over budget, and keeps trying cheaper tasks after skipping an expensive one', async () => {
    const callLLM = fakeCall(0.9); // realistic — uses most, not all, of its maxTokens ceiling
    const { writeRecord, written } = fakeWriter();
    // Budget large enough for the two cheap haiku tasks up front, too small for the sonnet task between them.
    const result = await runPilot({ tasks: PILOT_TASKS.slice(0, 5), dryRun: false, budgetUsd: 0.02, callLLM, writeRecord });

    expect(result.spentUsd).toBeLessThanOrEqual(0.02);
    const statuses = result.results.map((r) => r.status);
    expect(statuses).toContain('skipped-budget');
    expect(statuses).toContain('created'); // a later, cheaper task still ran after the skip
  });

  it('refuses to run at all if the task list itself violates the spread rule', async () => {
    const skewed = Array.from({ length: 10 }, (_, i) => ({ ...PILOT_TASKS[0], id: `dup-${i}`, workType: 'bug-fix' }));
    await expect(runPilot({ tasks: skewed, dryRun: false, callLLM: fakeCall(), writeRecord: fakeWriter().writeRecord }))
      .rejects.toThrow(/spread check failed/);
  });

  it('records a failure without crashing the rest of the run when the LLM call itself fails', async () => {
    const callLLM = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'rate limited' })
      .mockImplementation(fakeCall());
    const { writeRecord, written } = fakeWriter();
    const result = await runPilot({ tasks: PILOT_TASKS.slice(0, 3), dryRun: false, callLLM, writeRecord });
    expect(result.results[0].status).toBe('call-failed');
    expect(result.results.slice(1).every((r) => r.status === 'created')).toBe(true);
    expect(written).toHaveLength(2);
  });

  it('the full default task list stays comfortably within the default 30 USD budget on worst-case pricing alone', async () => {
    const callLLM = fakeCall(1.0); // absolute worst case — every task uses its full maxTokens ceiling
    const { writeRecord } = fakeWriter();
    const result = await runPilot({ tasks: PILOT_TASKS, dryRun: false, budgetUsd: DEFAULT_BUDGET_USD, callLLM, writeRecord });
    const created = result.results.filter((r) => r.status === 'created');
    expect(created.length).toBe(PILOT_TASKS.length); // nothing skipped — real headroom is large
    expect(result.spentUsd).toBeLessThan(2); // verified in practice: real total is well under $1
  });
});

/**
 * writeTaskRecord itself, against the real docops package — not the fake
 * writer above. T16/T17 (added after T8's own script) taught this the hard
 * way: a task record claiming status:'done' has to actually earn it
 * (estimate + doneCriteria), or `record phase-check` correctly flags it as
 * inconsistent — a real bug found by running `record phase-check` against
 * 16 real records this script wrote, before this fix.
 */
describe('writeTaskRecord — earns the status it claims, and validates for real', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'calibration-write-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes a record with an estimate and doneCriteria, grounded in the real actuals', () => {
    const task = PILOT_TASKS[0];
    const actuals = { inputTokens: 1000, outputTokens: 500, costUsd: 0.01 };
    const written = writeTaskRecord({ cwd: tmp, decisionId: DECISION_ID }, task, 'A short, active response.', actuals);
    expect('error' in written).toBe(false);

    const raw = readFileSync(written.filePath, 'utf8');
    const result = validateRecordFile(raw);
    expect(result.success, result.success ? '' : result.error.message).toBe(true);
    expect(result.record.status).toBe('done');
    expect(result.record.doneCriteria).toEqual({ testLayers: [] });
    expect(result.record.estimate.lowTokens).toBe(Math.round(1500 * 0.8));
    expect(result.record.estimate.highTokens).toBe(Math.round(1500 * 1.2));
    expect(result.record.estimate.lowTokens).toBeLessThanOrEqual(result.record.estimate.highTokens);
  });

  it('fails loudly at write time on a response that fails T21 readability, instead of writing a bad record', () => {
    const task = PILOT_TASKS[0];
    const actuals = { inputTokens: 1000, outputTokens: 500, costUsd: 0.01 };
    const dense =
      'It is believed that the configuration might possibly need to be updated by the maintainer prior to the release ' +
      'and this could somewhat affect downstream consumers who are utilizing the older interface so it should probably be reviewed.';
    const written = writeTaskRecord({ cwd: tmp, decisionId: DECISION_ID }, task, dense, actuals);
    expect('error' in written).toBe(true);
  });
});
