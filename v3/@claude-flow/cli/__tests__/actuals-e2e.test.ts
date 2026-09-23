/**
 * TASK-028 (T13, agentic SDLC plan) — end-to-end: a real task driven
 * through the state machine from `drafted`, once to `done` and once to
 * `blocked`, via `ruflo run`'s own real transitions (drafted -> specified
 * -> implementing are real `attemptTransition` calls; `implementing ->
 * verifying` is the one deliberate human gate this codebase has no
 * automated phase-runner for — simulated the same way every other test in
 * run.test.ts already does, not bypassed). T19's `verifyTask` and T20's
 * `runRepairLoop` are mocked with REALISTIC usage data (same discipline as
 * repair-loop.test.ts/task-repair.test.ts — no real `claude -p` spawn
 * anywhere in this suite), and this test asserts the resulting record's
 * `actuals` field holds those real numbers, not fabricated ones.
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
import runCommand from '../src/commands/run.js';

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

describe('actuals land in the record, drafted through to done and to blocked (TASK-028)', () => {
  let tmp: string;
  let ctx: CommandContext;
  let recordCommand: Command;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'actuals-e2e-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ recordCommand } = await import('../src/commands/records.js'));
    vi.mocked(runRepairLoop).mockReset();
    vi.mocked(verifyTask).mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Drafted, with an accepted citation, a real estimate, and empty doneCriteria — everything `drafted -> specified -> implementing` needs, none of it fabricated evidence (an estimate/doneCriteria a real caller would have set). */
  async function createDraftedTask(): Promise<{ id: string; filePath: string }> {
    // req new has no --status (Review #3, Important 1) — patch the file directly to accept it.
    ctx.flags = { title: 'req one', _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const { id: reqId, path: reqPath } = req?.data as { id: string; path: string };
    writeFileSync(reqPath, restampHash(readFileSync(reqPath, 'utf8').replace('status: draft', 'status: accepted')));

    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const { id, path: filePath } = task?.data as { id: string; path: string };

    const patched = readFileSync(filePath, 'utf8').replace(
      '---\n\n',
      'estimate:\n  lowTokens: 500\n  highTokens: 2000\n  confidence: 0.4\ndoneCriteria:\n  testLayers: []\n---\n\n',
    );
    writeFileSync(filePath, restampHash(patched));
    return { id, filePath };
  }

  /** Advances drafted -> specified -> implementing for real (two real `attemptTransition` calls inside one `ruflo run` pass), then simulates the one deliberate human gate this codebase has (implementing -> verifying is never automated). */
  async function driveToVerifying(filePath: string): Promise<void> {
    ctx.args = [];
    ctx.flags = { _: [] };
    await runCommand.action!(ctx);
    expect(readFileSync(filePath, 'utf8')).toContain('status: implementing');
    writeFileSync(filePath, restampHash(readFileSync(filePath, 'utf8').replace('status: implementing', 'status: verifying')));
  }

  it('drafted through to done: actuals hold the real repair spend, not fabricated numbers', async () => {
    const { filePath } = await createDraftedTask();
    await driveToVerifying(filePath);

    // verifying -> blocked (a real red test result)
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: false, to: 'blocked', blocked: { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' } },
      testRun: { passed: false, exitCode: 1, command: 'npm test', output: 'FAIL', durationMs: 12, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });
    ctx.args = [];
    ctx.flags = { _: [] };
    await runCommand.action!(ctx);
    expect(readFileSync(filePath, 'utf8')).toContain('status: blocked');

    // blocked (verifying) --repair --confirm -> repaired -> done, with real usage
    vi.mocked(runRepairLoop).mockReturnValue({
      repaired: true,
      stopReason: 'repaired',
      attempts: [{ attempt: 1, repaired: true, exitCode: 0, costUsd: 0.18, outputHash: 'x', inputTokens: 2400, outputTokens: 610 }],
      totalCostUsd: 0.18,
      totalInputTokens: 2400,
      totalOutputTokens: 610,
    });
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 9, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });
    ctx.args = [];
    ctx.flags = { repair: true, confirm: true, _: [] };
    await runCommand.action!(ctx);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: done');
    expect(written).toMatch(/actuals:\s*\n\s*inputTokens:\s*2400/);
    expect(written).toMatch(/outputTokens:\s*610/);
    expect(written).toMatch(/costUsd:\s*0\.18/);
  });

  it('drafted through to blocked: actuals still hold the real repair spend — never unset just because it stayed blocked', async () => {
    const { filePath } = await createDraftedTask();
    await driveToVerifying(filePath);

    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: false, to: 'blocked', blocked: { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' } },
      testRun: { passed: false, exitCode: 1, command: 'npm test', output: 'FAIL', durationMs: 12, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });
    ctx.args = [];
    ctx.flags = { _: [] };
    await runCommand.action!(ctx);

    // blocked (verifying) --repair --confirm -> exhausted, still blocked, but real spend happened
    vi.mocked(runRepairLoop).mockReturnValue({
      repaired: false,
      stopReason: 'max-attempts-exhausted',
      attempts: [
        { attempt: 1, repaired: false, exitCode: 1, costUsd: 0.1, outputHash: 'a', inputTokens: 1500, outputTokens: 300 },
        { attempt: 2, repaired: false, exitCode: 1, costUsd: 0.1, outputHash: 'b', inputTokens: 1600, outputTokens: 320 },
      ],
      totalCostUsd: 0.2,
      totalInputTokens: 3100,
      totalOutputTokens: 620,
      lastOutput: 'still broken',
    });
    ctx.args = [];
    ctx.flags = { repair: true, confirm: true, _: [] };
    await runCommand.action!(ctx);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: blocked');
    expect(written).toContain('fromState: verifying');
    expect(written).toMatch(/actuals:\s*\n\s*inputTokens:\s*3100/);
    expect(written).toMatch(/outputTokens:\s*620/);
    expect(written).toMatch(/costUsd:\s*0\.2\b/);
  });
});
