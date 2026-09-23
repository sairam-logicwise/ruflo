/**
 * T24 (agentic SDLC plan), acceptance criterion #3: "An unconfirmed
 * record cannot satisfy a phase gate." No new gating code is needed for
 * this — T16's existing `checkCitationAcceptance()` already requires a
 * cited requirement/decision to be `status: accepted`, and an inferred
 * proposal is always written `status: draft` (infer.ts's own doc). This
 * suite proves the two pieces actually compose end to end, through
 * `ruflo run`'s real state machine: a task citing an unconfirmed,
 * agent-inferred requirement stays blocked; the SAME task advances the
 * moment `req confirm` runs — no other change.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';

vi.mock('../src/ruvector/repair-loop.js', () => ({ runRepairLoop: vi.fn() }));
vi.mock('../src/ruvector/test-runner.js', async () => {
  const actual = await vi.importActual<typeof import('../src/ruvector/test-runner.js')>('../src/ruvector/test-runner.js');
  return { ...actual, verifyTask: vi.fn() };
});

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

describe('an unconfirmed inferred record cannot satisfy a phase gate (T24 x T16)', () => {
  let tmp: string;
  let ctx: CommandContext;
  let recordCommand: Command;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 't24-gate-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ recordCommand } = await import('../src/commands/records.js'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('blocks drafted -> specified while the cited requirement is draft, then advances once confirmed', async () => {
    // A real T24 proposal: agent-inferred, confidence-bearing, and — the
    // whole point — NOT accepted yet.
    ctx.flags = { title: 'Inferred from real code', provenance: 'agent-inferred', confidence: 0.55, _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const reqId = (req?.data as { id: string }).id;
    expect(readFileSync((req?.data as { path: string }).path, 'utf8')).toContain('status: draft');

    ctx.flags = { title: 'A task citing the inferred requirement', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const taskPath = (task?.data as { path: string }).path;
    writeFileSync(taskPath, readFileSync(taskPath, 'utf8').replace(
      '---\n\n',
      'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n',
    ));

    // Pass 1: blocked — the cited requirement is real, but not confirmed.
    ctx.args = [];
    ctx.flags = { _: [] };
    const before = await runCommand.action!(ctx);
    expect(readFileSync(taskPath, 'utf8')).toContain('status: blocked');
    const beforeData = before?.data as { stuck: Array<{ reason: string }> };
    expect(beforeData.stuck.some((s) => /not accepted/.test(s.reason))).toBe(true);

    // Confirm the requirement (T24's own confirmation command) — nothing else changes.
    ctx.args = [reqId];
    ctx.flags = { _: [] };
    const confirmed = await sub(recordCommand, 'req', 'confirm').action!(ctx);
    expect(confirmed?.success).toBe(true);

    // Pass 2: the SAME task now advances — no other input changed. `ruflo
    // run` keeps advancing within one call while it keeps making progress,
    // so this reaches `implementing` (specified's own transition, then
    // implementing's) and stops there — the one deliberate human gate this
    // codebase has (implementing -> verifying is never automated), not
    // blocked on the citation any more.
    ctx.args = [];
    ctx.flags = { _: [] };
    const after = await runCommand.action!(ctx);
    const written = readFileSync(taskPath, 'utf8');
    expect(written).toContain('status: implementing');
    expect(written).not.toContain('not accepted');
    const afterData = after?.data as { stuck: Array<{ reason: string }> };
    expect(afterData.stuck.every((s) => !/not accepted/.test(s.reason))).toBe(true);
  });
});
