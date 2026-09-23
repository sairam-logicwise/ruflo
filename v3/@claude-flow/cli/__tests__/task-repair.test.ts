/**
 * T20 (agentic SDLC plan) — `ruflo record task repair`. The command layer:
 * refuses anything but a task T19 blocked from "verifying" (a red test,
 * not some other precondition failure), runs the bounded repair loop, and
 * writes the DERIVED result back — reusing T19's own `verifyTask` to
 * re-check a claimed repair rather than trusting tdd-repair.mjs's
 * self-report.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';
import { restampHash } from './record-test-utils.js';

vi.mock('../src/ruvector/repair-loop.js', () => ({ runRepairLoop: vi.fn() }));
vi.mock('../src/ruvector/test-runner.js', async () => {
  const actual = await vi.importActual<typeof import('../src/ruvector/test-runner.js')>('../src/ruvector/test-runner.js');
  return { ...actual, verifyTask: vi.fn() };
});

import { runRepairLoop } from '../src/ruvector/repair-loop.js';
import { verifyTask } from '../src/ruvector/test-runner.js';
import { loadCalibrationRows } from '../src/ruvector/estimator/corpus.js';

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

describe('ruflo record task repair', () => {
  let tmp: string;
  let ctx: CommandContext;
  let recordCommand: Command;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'repair-cmd-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ recordCommand } = await import('../src/commands/records.js'));
    vi.mocked(runRepairLoop).mockReset();
    vi.mocked(verifyTask).mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function createTaskInState(status: string, blocked?: { reason: string; unblockCondition: string; fromState: string }): Promise<{ id: string; filePath: string }> {
    ctx.flags = { title: 'req one', _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const reqId = (req?.data as { id: string }).id;

    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const { id, path: filePath } = task?.data as { id: string; path: string };

    let raw = readFileSync(filePath, 'utf8').replace('status: drafted', `status: ${status}`);
    if (blocked) {
      raw = raw.replace(
        '---\n\n',
        `blocked:\n  reason: ${blocked.reason}\n  unblockCondition: ${blocked.unblockCondition}\n  fromState: ${blocked.fromState}\n---\n\n`,
      );
    }
    writeFileSync(filePath, restampHash(raw));
    return { id, filePath };
  }

  it('refuses a task that is not blocked', async () => {
    const { id } = await createTaskInState('verifying');
    ctx.args = [id];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(result?.success).toBe(false);
    expect(runRepairLoop).not.toHaveBeenCalled();
  });

  it('refuses a task blocked for a reason other than a red test', async () => {
    const { id } = await createTaskInState('blocked', { reason: 'no done criteria declared', unblockCondition: 'set doneCriteria', fromState: 'implementing' });
    ctx.args = [id];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(result?.success).toBe(false);
    expect(runRepairLoop).not.toHaveBeenCalled();
  });

  it('refuses a missing id', async () => {
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(result?.success).toBe(false);
  });

  it('refuses a nonexistent task id', async () => {
    ctx.args = ['TASK-999'];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(result?.success).toBe(false);
  });

  it('without --confirm, reports the plan and touches nothing on disk', async () => {
    const { id, filePath } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    const before = readFileSync(filePath, 'utf8');
    vi.mocked(runRepairLoop).mockReturnValue({ repaired: false, stopReason: 'dry-run', attempts: [], totalCostUsd: 0, plan: { repo: tmp, testCommand: 'npm test', maxAttempts: 3, budgetUsd: 5, model: 'haiku' } });

    ctx.args = [id];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(result?.success).toBe(true);
    expect((result?.data as { dryRun?: boolean }).dryRun).toBe(true);
    expect(verifyTask).not.toHaveBeenCalled();
    expect(readFileSync(filePath, 'utf8')).toBe(before);
  });

  it('forwards --confirm through to the repair loop', async () => {
    const { id } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    vi.mocked(runRepairLoop).mockReturnValue({ repaired: false, stopReason: 'dry-run', attempts: [], totalCostUsd: 0 });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(runRepairLoop).toHaveBeenCalledWith(expect.objectContaining({ confirm: true }));
  });

  it('on a successful repair, re-verifies with T19s trusted runner and writes the real result', async () => {
    const { id, filePath } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    vi.mocked(runRepairLoop).mockReturnValue({
      repaired: true,
      stopReason: 'repaired',
      attempts: [{ attempt: 1, repaired: true, exitCode: 0, costUsd: 0.2, outputHash: 'abc' }],
      totalCostUsd: 0.2,
    });
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 10, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    const result = await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(result?.success).toBe(true);
    expect(verifyTask).toHaveBeenCalledTimes(1);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: done');
    expect(written).not.toContain('blocked:');
  });

  it('does NOT trust a claimed repair blindly — a repaired-but-still-red re-verify stays blocked', async () => {
    const { id, filePath } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    vi.mocked(runRepairLoop).mockReturnValue({ repaired: true, stopReason: 'repaired', attempts: [], totalCostUsd: 0.1 });
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: false, to: 'blocked', blocked: { reason: 'the test result is red', unblockCondition: 'fix the failing tests, then re-run verification', fromState: 'verifying' } },
      testRun: { passed: false, exitCode: 1, command: 'npm test', output: 'FAIL', durationMs: 10, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(readFileSync(filePath, 'utf8')).toContain('status: blocked');
  });

  it('on exhaustion, stays blocked with the stop reason and failing output folded into the reason', async () => {
    const { id, filePath } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    vi.mocked(runRepairLoop).mockReturnValue({
      repaired: false,
      stopReason: 'max-attempts-exhausted',
      attempts: [
        { attempt: 1, repaired: false, exitCode: 1, costUsd: 0.1, outputHash: 'a' },
        { attempt: 2, repaired: false, exitCode: 1, costUsd: 0.1, outputHash: 'b' },
        { attempt: 3, repaired: false, exitCode: 1, costUsd: 0.1, outputHash: 'c' },
      ],
      totalCostUsd: 0.3,
      lastOutput: 'TypeError: still broken',
    });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    const result = await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(result?.success).toBe(true); // the command succeeded at deriving+writing a verdict
    expect(verifyTask).not.toHaveBeenCalled();

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: blocked');
    expect(written).toMatch(/max-attempts-exhausted/);
    expect(written).toContain('TypeError: still broken');
    expect(written).toContain('fromState: verifying');
  });

  // T13: a repair's real spend is captured into the record's actuals field,
  // whether the repair ended repaired (TASK-025) or exhausted-and-blocked
  // (TASK-026) — never left unset just because the ending was blocked.
  it('writes real actuals onto a successful repair', async () => {
    const { id, filePath } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    vi.mocked(runRepairLoop).mockReturnValue({
      repaired: true,
      stopReason: 'repaired',
      attempts: [{ attempt: 1, repaired: true, exitCode: 0, costUsd: 0.2, outputHash: 'abc', inputTokens: 1200, outputTokens: 300 }],
      totalCostUsd: 0.2,
      totalInputTokens: 1200,
      totalOutputTokens: 300,
    });
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 10, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    await sub(recordCommand, 'task', 'repair').action!(ctx);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toMatch(/actuals:\s*\n\s*inputTokens:\s*1200/);
    expect(written).toMatch(/outputTokens:\s*300/);
    expect(written).toMatch(/costUsd:\s*0\.2/);
  });

  it('writes real actuals onto an exhausted, still-blocked repair (TASK-026 — never left unset on failure)', async () => {
    const { id, filePath } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    vi.mocked(runRepairLoop).mockReturnValue({
      repaired: false,
      stopReason: 'max-attempts-exhausted',
      attempts: [
        { attempt: 1, repaired: false, exitCode: 1, costUsd: 0.1, outputHash: 'a', inputTokens: 1000, outputTokens: 200 },
        { attempt: 2, repaired: false, exitCode: 1, costUsd: 0.1, outputHash: 'b', inputTokens: 1100, outputTokens: 220 },
      ],
      totalCostUsd: 0.2,
      totalInputTokens: 2100,
      totalOutputTokens: 420,
      lastOutput: 'still broken',
    });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    const result = await sub(recordCommand, 'task', 'repair').action!(ctx);
    expect(result?.success).toBe(true);
    expect(verifyTask).not.toHaveBeenCalled();

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: blocked');
    expect(written).toMatch(/actuals:\s*\n\s*inputTokens:\s*2100/);
    expect(written).toMatch(/outputTokens:\s*420/);
  });

  // TASK-027: T10's loadCalibrationRows scans docs/tasks/ fresh on every
  // call — a newly-captured actuals row should show up on the very next
  // read, with no separate manual step.
  it('a task actuals-captured by repair feeds the estimator corpus on the next read, automatically', async () => {
    const { id } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    expect(loadCalibrationRows(tmp)).toEqual([]); // nothing in the corpus yet

    vi.mocked(runRepairLoop).mockReturnValue({
      repaired: false,
      stopReason: 'max-attempts-exhausted',
      attempts: [{ attempt: 1, repaired: false, exitCode: 1, costUsd: 0.15, outputHash: 'a', inputTokens: 900, outputTokens: 150 }],
      totalCostUsd: 0.15,
      totalInputTokens: 900,
      totalOutputTokens: 150,
      lastOutput: 'still broken',
    });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    await sub(recordCommand, 'task', 'repair').action!(ctx);

    const rows = loadCalibrationRows(tmp); // no extra step — same corpus reader T10/T11 already use
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 900, outputTokens: 150, source: 'calibration' });
    expect(rows[0].complexity).toBeGreaterThanOrEqual(0);
    expect(rows[0].complexity).toBeLessThanOrEqual(1);
  });

  it('omits actuals entirely when the repair never produced real usage data (no fabricated zeros)', async () => {
    const { id, filePath } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    vi.mocked(runRepairLoop).mockReturnValue({
      repaired: false,
      stopReason: 'tdd-repair-unavailable',
      attempts: [{ attempt: 1, repaired: false, exitCode: 1, costUsd: 0, outputHash: null }],
      totalCostUsd: 0,
    });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    await sub(recordCommand, 'task', 'repair').action!(ctx);

    expect(readFileSync(filePath, 'utf8')).not.toContain('actuals:');
  });

  it('the resulting record always validates, on both endings', async () => {
    const { id } = await createTaskInState('blocked', { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' });
    vi.mocked(runRepairLoop).mockReturnValue({ repaired: false, stopReason: 'repeated-failure', attempts: [], totalCostUsd: 0.1, lastOutput: 'same failure' });

    ctx.args = [id];
    ctx.flags = { confirm: true, _: [] };
    await sub(recordCommand, 'task', 'repair').action!(ctx);

    ctx.flags = { _: [] };
    const validated = await sub(recordCommand, 'validate').action!(ctx);
    expect(validated?.success).toBe(true);
  });
});
