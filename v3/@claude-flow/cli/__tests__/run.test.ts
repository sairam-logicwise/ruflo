/**
 * T25 (agentic SDLC plan) — `ruflo run`, the autonomy loop. Every claim
 * this suite makes is backed by a real state-machine precondition
 * (drafted/specified) or a mocked, exit-code-driven T19/T20 call — no real
 * `claude -p` spawn happens anywhere in here, same discipline as T20's own
 * repair-loop.test.ts.
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

describe('ruflo run', () => {
  let tmp: string;
  let ctx: CommandContext;
  let recordCommand: Command;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'run-cmd-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ recordCommand } = await import('../src/commands/records.js'));
    vi.mocked(runRepairLoop).mockReset();
    vi.mocked(verifyTask).mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function createTask(patch?: (raw: string) => string, reqStatus: 'accepted' | 'draft' = 'accepted'): Promise<{ id: string; filePath: string }> {
    // Defaults to an ACCEPTED citation so every test that isn't specifically
    // about T16's citation-acceptance gate exercises only the precondition
    // it names, same "arrange only what the test is about" reasoning as the
    // rest of this suite. req new has no --status (Review #3, Important 1
    // — a real exploit, the gate must not be self-serviceable at creation),
    // so acceptance is set by patching the file directly, same as every
    // other post-creation status patch in this suite.
    ctx.flags = { title: 'req one', _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const { id: reqId, path: reqPath } = req?.data as { id: string; path: string };
    if (reqStatus === 'accepted') {
      writeFileSync(reqPath, restampHash(readFileSync(reqPath, 'utf8').replace('status: draft', 'status: accepted')));
    }

    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const { id, path: filePath } = task?.data as { id: string; path: string };

    if (patch) writeFileSync(filePath, restampHash(patch(readFileSync(filePath, 'utf8'))));
    return { id, filePath };
  }

  it('reports nothing to do when there are no task records', async () => {
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await runCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as { outcomes: unknown[]; stuck: unknown[] };
    expect(data.outcomes).toHaveLength(0);
    expect(data.stuck).toHaveLength(0);
  });

  it('blocks a drafted task with no estimate — real evidence gate, not exploited', async () => {
    const { filePath } = await createTask();
    ctx.args = [];
    ctx.flags = { _: [] };
    await runCommand.action!(ctx);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: blocked');
    expect(written).toContain('reason: no estimate recorded');
    expect(written).toContain('fromState: drafted');
  });

  it('T16: blocks a drafted task whose citation is not accepted, even with a real estimate', async () => {
    const { filePath } = await createTask(
      (raw) => raw.replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\n---\n\n'),
      'draft',
    );
    ctx.args = [];
    ctx.flags = { _: [] };
    await runCommand.action!(ctx);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: blocked');
    expect(written).toContain('cited record(s) not accepted: REQ-001');
    expect(written).toContain('fromState: drafted');
  });

  it('a blocked-from-drafted task resumes once a human fixes the underlying condition (found via T16 manual verification — resumeFromBlocked had no caller at all before this)', async () => {
    ctx.flags = { title: 'req one', _: [] }; // draft by construction — no --status any more (Important 1)
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const { id: reqId, path: reqPath } = req?.data as { id: string; path: string };

    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const { path: filePath } = task?.data as { id: string; path: string };
    writeFileSync(filePath, restampHash(readFileSync(filePath, 'utf8').replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\n---\n\n')));

    ctx.args = [];
    ctx.flags = { _: [] };
    await runCommand.action!(ctx);
    expect(readFileSync(filePath, 'utf8')).toContain('cited record(s) not accepted');

    // A human accepts the requirement between runs — no tooling change, just editing the file,
    // exactly like every other "fix it by hand" pattern already used throughout this plan.
    writeFileSync(reqPath, restampHash(readFileSync(reqPath, 'utf8').replace('status: draft', 'status: accepted')));

    ctx.flags = { _: [] };
    await runCommand.action!(ctx);
    const written = readFileSync(filePath, 'utf8');
    // Real progress: it resumed past the citation gate into "specified", then immediately
    // hit the NEXT real precondition (no doneCriteria, never set in this test) — a
    // different blocked reason than before, proof the resume actually advanced the task
    // rather than getting stuck re-reporting the original citation problem.
    expect(written).toContain('status: blocked');
    expect(written).toContain('reason: no done criteria declared');
    expect(written).toContain('fromState: specified');
    expect(written).not.toContain('not accepted');
  });

  it('a genuinely stuck blocked-from-drafted task is reported once and never rewritten again within the same run', async () => {
    const { filePath } = await createTask(undefined, 'draft'); // no estimate either — nothing a human has fixed
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await runCommand.action!(ctx);

    const data = result?.data as { passes: number; outcomes: Array<{ id: string }> };
    expect(data.passes).toBeLessThan(4); // bounded quickly, not spinning toward --max-passes
    expect(data.outcomes.filter((o) => o.id === 'TASK-001')).toHaveLength(1); // written exactly once, not re-churned pass after pass
    expect(readFileSync(filePath, 'utf8')).toContain('cited record(s) not accepted');
  });

  it('advances a task all the way to implementing across passes once estimate and doneCriteria are both present', async () => {
    const { filePath } = await createTask((raw) =>
      raw.replace(
        '---\n\n',
        'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n',
      ),
    );
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await runCommand.action!(ctx);
    expect(result?.success).toBe(true);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: implementing');
  });

  it('honours --max-passes, stopping progress short even if more is possible', async () => {
    const { filePath } = await createTask((raw) =>
      raw.replace(
        '---\n\n',
        'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n',
      ),
    );
    ctx.args = [];
    ctx.flags = { maxPasses: 1, _: [] };
    await runCommand.action!(ctx);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: specified'); // not yet "implementing" — capped at one pass
  });

  it('never auto-advances "implementing" — it always needs a human', async () => {
    const { filePath } = await createTask((raw) => raw.replace('status: drafted', 'status: implementing'));
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await runCommand.action!(ctx);

    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: implementing'); // untouched
    const data = result?.data as { stuck: Array<{ status: string; reason: string }> };
    expect(data.stuck.some((s) => s.status === 'implementing' && /human/.test(s.reason))).toBe(true);
  });

  it('runs verify on a "verifying" task and writes a real green result', async () => {
    const { filePath } = await createTask((raw) => raw.replace('status: drafted', 'status: verifying'));
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 10, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });

    ctx.args = [];
    ctx.flags = { _: [] };
    await runCommand.action!(ctx);

    expect(readFileSync(filePath, 'utf8')).toContain('status: done');
  });

  it('a red verify result stays blocked and is reported, not auto-repaired without --repair', async () => {
    const { filePath } = await createTask((raw) => raw.replace('status: drafted', 'status: verifying'));
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: false, to: 'blocked', blocked: { reason: 'the test result is red', unblockCondition: 'fix it', fromState: 'verifying' } },
      testRun: { passed: false, exitCode: 1, command: 'npm test', output: 'FAIL', durationMs: 10, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });

    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await runCommand.action!(ctx);

    expect(readFileSync(filePath, 'utf8')).toContain('status: blocked');
    expect(runRepairLoop).not.toHaveBeenCalled();
    const data = result?.data as { stuck: Array<{ reason: string }> };
    expect(data.stuck.some((s) => /--repair/.test(s.reason))).toBe(true);
  });

  it('with --repair --confirm, repairs a red task and re-verifies before writing done', async () => {
    const { filePath } = await createTask((raw) => {
      let r = raw.replace('status: drafted', 'status: blocked');
      r = r.replace('---\n\n', 'blocked:\n  reason: the test result is red\n  unblockCondition: fix it\n  fromState: verifying\n---\n\n');
      return r;
    });
    vi.mocked(runRepairLoop).mockReturnValue({ repaired: true, stopReason: 'repaired', attempts: [], totalCostUsd: 0.2 });
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 10, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });

    ctx.args = [];
    ctx.flags = { repair: true, confirm: true, _: [] };
    await runCommand.action!(ctx);

    expect(readFileSync(filePath, 'utf8')).toContain('status: done');
    expect(runRepairLoop).toHaveBeenCalledTimes(1);
  });

  it('never retries a failed repair twice in the same run', async () => {
    const { filePath } = await createTask((raw) => {
      let r = raw.replace('status: drafted', 'status: blocked');
      r = r.replace('---\n\n', 'blocked:\n  reason: the test result is red\n  unblockCondition: fix it\n  fromState: verifying\n---\n\n');
      return r;
    });
    vi.mocked(runRepairLoop).mockReturnValue({ repaired: false, stopReason: 'max-attempts-exhausted', attempts: [], totalCostUsd: 0.3, lastOutput: 'still broken' });

    ctx.args = [];
    ctx.flags = { repair: true, confirm: true, _: [] };
    const result = await runCommand.action!(ctx);

    expect(runRepairLoop).toHaveBeenCalledTimes(1); // not re-invoked on a later internal pass
    const written = readFileSync(filePath, 'utf8');
    expect(written).toContain('status: blocked');
    expect(written).toMatch(/max-attempts-exhausted/);
    const data = result?.data as { stuck: Array<{ reason: string }> };
    expect(data.stuck.some((s) => /already attempted this run/.test(s.reason))).toBe(true);
  });

  it('T26: stops attempting repair once the spend ceiling is reached, without calling the repair loop again', async () => {
    const blockedPatch = (raw: string) => {
      let r = raw.replace('status: drafted', 'status: blocked');
      r = r.replace('---\n\n', 'blocked:\n  reason: the test result is red\n  unblockCondition: fix it\n  fromState: verifying\n---\n\n');
      return r;
    };
    await createTask(blockedPatch);
    const second = await createTask(blockedPatch);
    vi.mocked(runRepairLoop).mockReturnValue({ repaired: false, stopReason: 'max-attempts-exhausted', attempts: [], totalCostUsd: 0.2, lastOutput: 'still broken' });

    ctx.args = [];
    ctx.flags = { repair: true, confirm: true, spendCeiling: 0.15, _: [] };
    const result = await runCommand.action!(ctx);

    // Both tasks are eligible, but the ceiling ($0.15) is below even the FIRST repair's cost ($0.2) —
    // so the second task must never reach the repair loop at all.
    expect(runRepairLoop).toHaveBeenCalledTimes(1);
    const data = result?.data as { stuck: Array<{ id: string; reason: string }>; spentUsd: number; spendCeilingUsd: number };
    expect(data.stuck.some((s) => s.id === second.id && /spend ceiling reached/.test(s.reason))).toBe(true);
    expect(data.spentUsd).toBeCloseTo(0.2);
    expect(data.spendCeilingUsd).toBe(0.15);
  });

  it('T26: a fresh invocation never carries spend forward from a previous one', async () => {
    const blockedPatch = (raw: string) => {
      let r = raw.replace('status: drafted', 'status: blocked');
      r = r.replace('---\n\n', 'blocked:\n  reason: the test result is red\n  unblockCondition: fix it\n  fromState: verifying\n---\n\n');
      return r;
    };
    await createTask(blockedPatch);
    vi.mocked(runRepairLoop).mockReturnValue({ repaired: true, stopReason: 'repaired', attempts: [], totalCostUsd: 5 });
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 10, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });

    ctx.args = [];
    ctx.flags = { repair: true, confirm: true, spendCeiling: 100, _: [] };
    const firstRun = await runCommand.action!(ctx);
    expect((firstRun?.data as { spentUsd: number }).spentUsd).toBeCloseTo(5);
    expect(runRepairLoop).toHaveBeenCalledTimes(1);

    // A second, separate invocation (a real second `ruflo run`) — the task is now `done` (the
    // repair succeeded), so there is nothing left to repair. This run must report $0 of its own,
    // never the first invocation's $5 — there is no module-level or persisted counter it could
    // have carried that $5 forward from.
    vi.mocked(runRepairLoop).mockClear();
    ctx.flags = { repair: true, confirm: true, spendCeiling: 100, _: [] };
    const secondRun = await runCommand.action!(ctx);
    expect((secondRun?.data as { spentUsd: number }).spentUsd).toBe(0);
    expect(runRepairLoop).not.toHaveBeenCalled();
  });

  it('the spend ceiling never gates free transitions (drafted/specified/verifying)', async () => {
    await createTask((raw) =>
      raw.replace(
        '---\n\n',
        'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n',
      ),
    );
    ctx.args = [];
    ctx.flags = { spendCeiling: 0, _: [] }; // already exhausted, but nothing here costs anything
    const result = await runCommand.action!(ctx);
    const data = result?.data as { outcomes: Array<{ status: string }> };
    expect(data.outcomes.some((o) => o.status === 'implementing')).toBe(true);
  });

  it('the resulting records always validate', async () => {
    await createTask((raw) => raw.replace('status: drafted', 'status: verifying'));
    vi.mocked(verifyTask).mockResolvedValue({
      transition: { ok: true, to: 'done' },
      testRun: { passed: true, exitCode: 0, command: 'npm test', output: '', durationMs: 10, timestamp: '2026-09-23T00:00:00.000Z', gitSha: 'abc1234' },
    });
    ctx.args = [];
    ctx.flags = { _: [] };
    await runCommand.action!(ctx);

    ctx.flags = { _: [] };
    const validated = await sub(recordCommand, 'validate').action!(ctx);
    expect(validated?.success).toBe(true);
  });
});
