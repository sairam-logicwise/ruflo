/**
 * Review #3, Important 6 — `ruflo record task ready`. Closes the gap the
 * review found: nothing in this codebase could move a task out of
 * `implementing` except a hand-edit — this is the real, gated command
 * for "an agent/human signals readiness to verify" (state-machine.ts's
 * own words for the `implementing -> verifying` precondition, an
 * intentional no-op, never auto-advanced by `ruflo run`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';
import { recordCommand } from '../src/commands/records.js';
import { restampHash } from './record-test-utils.js';

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

describe('ruflo record task ready', () => {
  let tmp: string;
  let ctx: CommandContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ready-cmd-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function createTaskAtImplementing(): Promise<{ id: string; filePath: string }> {
    ctx.flags = { title: 'req one', _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const { id: reqId, path: reqPath } = req?.data as { id: string; path: string };
    writeFileSync(reqPath, restampHash(readFileSync(reqPath, 'utf8').replace('status: draft', 'status: accepted')));

    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const { id, path: filePath } = task?.data as { id: string; path: string };
    const patched = readFileSync(filePath, 'utf8')
      .replace('status: drafted', 'status: implementing')
      .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n');
    writeFileSync(filePath, restampHash(patched));
    return { id, filePath };
  }

  it('is wired in as a subcommand of task', () => {
    expect(() => sub(recordCommand, 'task', 'ready')).not.toThrow();
  });

  it('refuses a missing id', async () => {
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'ready').action!(ctx);
    expect(result?.success).toBe(false);
  });

  it('refuses a nonexistent task id', async () => {
    ctx.args = ['TASK-999'];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'ready').action!(ctx);
    expect(result?.success).toBe(false);
  });

  it('refuses a task not currently "implementing"', async () => {
    ctx.flags = { title: 'req one', _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const reqId = (req?.data as { id: string }).id;
    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx); // status: drafted
    const { id } = task?.data as { id: string };

    ctx.args = [id];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'ready').action!(ctx);
    expect(result?.success).toBe(false);
  });

  it('advances a real "implementing" task to "verifying"', async () => {
    const { id, filePath } = await createTaskAtImplementing();

    ctx.args = [id];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'task', 'ready').action!(ctx);
    expect(result?.success).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toContain('status: verifying');
  });

  it('never writes anything on refusal', async () => {
    ctx.flags = { title: 'req one', _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const reqId = (req?.data as { id: string }).id;
    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const { id, path: filePath } = task?.data as { id: string; path: string };
    const before = readFileSync(filePath, 'utf8');

    ctx.args = [id];
    ctx.flags = { _: [] };
    await sub(recordCommand, 'task', 'ready').action!(ctx);
    expect(readFileSync(filePath, 'utf8')).toBe(before);
  });

  it('the resulting record validates for real', async () => {
    const { id } = await createTaskAtImplementing();
    ctx.args = [id];
    ctx.flags = { _: [] };
    await sub(recordCommand, 'task', 'ready').action!(ctx);

    ctx.flags = { _: [] };
    const validated = await sub(recordCommand, 'validate').action!(ctx);
    expect(validated?.success).toBe(true);
  });

  it('composes with `ruflo run`: a task blocked on "no automated phase-runner" advances once marked ready', async () => {
    const { id, filePath } = await createTaskAtImplementing();
    const { default: runCommand } = await import('../src/commands/run.js');

    const before = await runCommand.action!({ args: [], flags: { _: [] }, cwd: tmp, interactive: false });
    const beforeData = before?.data as { stuck: Array<{ id: string; reason: string }> };
    expect(beforeData.stuck.some((s) => s.id === id && /task ready/.test(s.reason))).toBe(true);

    ctx.args = [id];
    ctx.flags = { _: [] };
    await sub(recordCommand, 'task', 'ready').action!(ctx);
    expect(readFileSync(filePath, 'utf8')).toContain('status: verifying');
  });
});
