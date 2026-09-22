/**
 * T19 (agentic SDLC plan) — `ruflo record task verify`. The command
 * layer: reads a task, refuses unless it is in "verifying", writes the
 * DERIVED result back, and never accepts a raw status override.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';

vi.mock('../src/ruvector/test-runner.js', () => ({ verifyTask: vi.fn() }));

import { verifyTask } from '../src/ruvector/test-runner.js';

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

describe('ruflo record task verify', () => {
  let tmp: string;
  let ctx: CommandContext;
  let recordCommand: Command;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'verify-cmd-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ recordCommand } = await import('../src/commands/records.js'));
    vi.mocked(verifyTask).mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function createTaskInState(status: string): Promise<{ id: string; filePath: string }> {
    ctx.flags = { title: 'req one', _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const reqId = (req?.data as { id: string }).id;

    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const { id, path: filePath } = task?.data as { id: string; path: string };

    // Move it straight to the target status for the test — bypassing the
    // real state machine here is fine, this test is about the verify
    // command's own wiring, not about how a task legitimately reaches
    // "verifying" (T15/T16's concern).
    const raw = readFileSync(filePath, 'utf8').replace('status: drafted', `status: ${status}`);
    writeFileSync(filePath, raw);
    return { id, filePath };
  }

  it('refuses a task not in "verifying"', async () => {
    const { id } = await createTaskInState('drafted');
    ctx.args = [id];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'verify').action!(ctx);
    expect(result?.success).toBe(false);
    expect(verifyTask).not.toHaveBeenCalled();
  });

  it('refuses a missing id', async () => {
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'verify').action!(ctx);
    expect(result?.success).toBe(false);
  });

  it('refuses a nonexistent task id', async () => {
    ctx.args = ['TASK-999'];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'verify').action!(ctx);
    expect(result?.success).toBe(false);
  });

  it('on a passing transition, writes status: done and clears any prior blocked info', async () => {
    const { id, filePath } = await createTaskInState('verifying');
    let raw = readFileSync(filePath, 'utf8');
    raw = raw.replace('---\n\n', 'blocked:\n  reason: old\n  unblockCondition: old\n  fromState: implementing\n---\n\n');
    writeFileSync(filePath, raw);

    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 100 },
    });

    ctx.args = [id];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'verify').action!(ctx);
    expect(result?.success).toBe(true);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: done');
    expect(written).not.toContain('blocked:');
  });

  it('on a failing transition, writes status: blocked with the reason and unblock condition', async () => {
    const { id, filePath } = await createTaskInState('verifying');

    vi.mocked(verifyTask).mockResolvedValue({
      transition: {
        ok: false,
        to: 'blocked',
        blocked: { reason: 'the test result is red', unblockCondition: 'fix the failing tests, then re-run verification', fromState: 'verifying' },
      },
      testRun: { passed: false, exitCode: 1, command: 'npm test', output: 'FAIL', durationMs: 50 },
    });

    ctx.args = [id];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'verify').action!(ctx);
    expect(result?.success).toBe(true); // the COMMAND succeeded at deriving+writing a verdict, even though the verdict is "blocked"

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: blocked');
    expect(written).toContain('reason: the test result is red');
    expect(written).toContain('unblockCondition: fix the failing tests, then re-run verification');
    expect(written).toContain('fromState: verifying');
  });

  it('the resulting record always validates', async () => {
    const { id, filePath } = await createTaskInState('verifying');
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 10 },
    });
    ctx.args = [id];
    ctx.flags = { _: [] };
    await sub(recordCommand, 'task', 'verify').action!(ctx);

    ctx.flags = { _: [] };
    const validated = await sub(recordCommand, 'validate').action!(ctx);
    expect(validated?.success).toBe(true);
  });

  it('never accepts a raw status override — there is no such flag on this command', () => {
    const verifyCmd = sub(recordCommand, 'task', 'verify');
    expect(verifyCmd.options?.some((o) => o.name === 'status')).toBe(false);
  });
});
