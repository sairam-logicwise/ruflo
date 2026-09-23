/**
 * T17 (agentic SDLC plan) — `ruflo record phase-check`. A read-only audit
 * that a task's CURRENT recorded status is still earned by its CURRENT
 * fields — catches drift `record validate` alone can't (optional fields
 * that were required to REACH a status, and a citation that was accepted
 * when a task advanced but got superseded afterward).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

describe('ruflo record phase-check', () => {
  let tmp: string;
  let ctx: CommandContext;
  let recordCommand: Command;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'phase-check-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ recordCommand } = await import('../src/commands/records.js'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  async function createTask(reqStatus: 'accepted' | 'draft', patch?: (raw: string) => string): Promise<{ id: string; filePath: string; reqPath: string }> {
    // req new has no --status (Review #3, Important 1) — patch the file directly when the test needs it accepted.
    ctx.flags = { title: 'req one', _: [] };
    const req = await sub(recordCommand, 'req', 'new').action!(ctx);
    const { id: reqId, path: reqPath } = req?.data as { id: string; path: string };
    if (reqStatus === 'accepted') {
      writeFileSync(reqPath, readFileSync(reqPath, 'utf8').replace('status: draft', 'status: accepted'));
    }

    ctx.flags = { title: 'a task', citations: reqId, _: [] };
    const task = await sub(recordCommand, 'task', 'new').action!(ctx);
    const { id, path: filePath } = task?.data as { id: string; path: string };
    if (patch) writeFileSync(filePath, patch(readFileSync(filePath, 'utf8')));
    return { id, filePath, reqPath };
  }

  it('passes on an empty task set', async () => {
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(true);
  });

  it('a fresh "drafted" task has nothing to audit — passes', async () => {
    await createTask('draft');
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(true);
  });

  it('a "blocked" task is skipped — it already carries its own diagnosis', async () => {
    await createTask('draft', (raw) => raw.replace('status: drafted', 'status: blocked'));
    ctx.args = [];
    ctx.flags = { _: [] };
    // No `blocked:` field either — still must not crash or flag it; phase-check is not the validator for this.
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(true);
  });

  it('passes when "specified" genuinely has an estimate and an accepted citation', async () => {
    await createTask('accepted', (raw) =>
      raw
        .replace('status: drafted', 'status: specified')
        .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\n---\n\n'),
    );
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(true);
  });

  it('flags "specified" with no estimate at all — schema allows it, phase-check does not', async () => {
    const { id } = await createTask('accepted', (raw) => raw.replace('status: drafted', 'status: specified'));
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(false);
    const data = result?.data as { problems: Array<{ id: string; reason: string }> };
    expect(data.problems.some((p) => p.id === id && /no estimate/.test(p.reason))).toBe(true);
  });

  it('flags "specified" whose citation was accepted at transition time but has since been superseded', async () => {
    const { id, reqPath } = await createTask('accepted', (raw) =>
      raw
        .replace('status: drafted', 'status: specified')
        .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\n---\n\n'),
    );
    writeFileSync(reqPath, readFileSync(reqPath, 'utf8').replace('status: accepted', 'status: superseded'));

    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(false);
    const data = result?.data as { problems: Array<{ id: string; reason: string }> };
    expect(data.problems.some((p) => p.id === id && /not accepted/.test(p.reason))).toBe(true);
  });

  it('passes when "implementing" genuinely has doneCriteria, an estimate, and an accepted citation', async () => {
    await createTask('accepted', (raw) =>
      raw
        .replace('status: drafted', 'status: implementing')
        .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n'),
    );
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(true);
  });

  it('flags "implementing" with no doneCriteria at all', async () => {
    const { id } = await createTask('accepted', (raw) =>
      raw
        .replace('status: drafted', 'status: implementing')
        .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\n---\n\n'),
    );
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(false);
    const data = result?.data as { problems: Array<{ id: string; reason: string }> };
    expect(data.problems.some((p) => p.id === id && /done criteria/.test(p.reason))).toBe(true);
  });

  it('a "done" task is retroactively flagged if its citation was superseded after the fact, without re-running any tests', async () => {
    const { id, reqPath } = await createTask('accepted', (raw) =>
      raw
        .replace('status: drafted', 'status: done')
        .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n'),
    );
    writeFileSync(reqPath, readFileSync(reqPath, 'utf8').replace('status: accepted', 'status: superseded'));

    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(false);
    const data = result?.data as { problems: Array<{ id: string; reason: string }> };
    expect(data.problems.some((p) => p.id === id && /not accepted/.test(p.reason))).toBe(true);
  });

  it('a genuinely earned "done" task passes', async () => {
    await createTask('accepted', (raw) =>
      raw
        .replace('status: drafted', 'status: done')
        .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n'),
    );
    ctx.args = [];
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'phase-check').action!(ctx);
    expect(result?.success).toBe(true);
  });

  // Review #3, C1: the exploit the review demonstrated end to end — a
  // hand-written status: done with real test layers declared but no
  // evidence a test ever ran — is now caught here.
  describe('verification receipt for done (C1)', () => {
    it('flags a hand-written "done" with real test layers and no receipt at all', async () => {
      const { id } = await createTask('accepted', (raw) =>
        raw
          .replace('status: drafted', 'status: done')
          .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: [unit, e2e]\n  coverageThreshold: 95\n---\n\n'),
      );
      ctx.args = [];
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'phase-check').action!(ctx);
      expect(result?.success).toBe(false);
      const data = result?.data as { problems: Array<{ id: string; reason: string }> };
      expect(data.problems.some((p) => p.id === id && /no verification receipt/.test(p.reason))).toBe(true);
    });

    it('flags "done" whose receipt was produced against a DIFFERENT body than the one on disk now', async () => {
      const { id } = await createTask('accepted', (raw) =>
        raw
          .replace('status: drafted', 'status: done')
          .replace(
            '---\n\n',
            'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: [unit]\nverification:\n  command: npm test\n  exitCode: 0\n  timestamp: 2026-09-23T00:00:00.000Z\n  gitSha: abc1234\n  contentHash: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n---\n\n',
          ),
      );
      ctx.args = [];
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'phase-check').action!(ctx);
      expect(result?.success).toBe(false);
      const data = result?.data as { problems: Array<{ id: string; reason: string }> };
      expect(data.problems.some((p) => p.id === id && /different body/.test(p.reason))).toBe(true);
    });

    it('passes "done" with real test layers when the receipt matches the CURRENT content hash', async () => {
      // Build the record for real first, so contentHash is the record's own real hash.
      const { filePath } = await createTask('accepted', (raw) =>
        raw
          .replace('status: drafted', 'status: done')
          .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: [unit]\n---\n\n'),
      );
      const raw = readFileSync(filePath, 'utf8');
      const realHash = /contentHash: ([0-9a-f]+)/.exec(raw)![1];
      writeFileSync(
        filePath,
        raw.replace(
          '---\n\n',
          `verification:\n  command: npm test\n  exitCode: 0\n  timestamp: 2026-09-23T00:00:00.000Z\n  gitSha: abc1234\n  contentHash: ${realHash}\n---\n\n`,
        ),
      );
      ctx.args = [];
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'phase-check').action!(ctx);
      expect(result?.success).toBe(true);
    });

    it('does not require a receipt at all when testLayers is empty — T18s own "no tests needed" is a real exemption, not a gap', async () => {
      await createTask('accepted', (raw) =>
        raw
          .replace('status: drafted', 'status: done')
          .replace('---\n\n', 'estimate:\n  lowTokens: 100\n  highTokens: 200\n  confidence: 0.5\ndoneCriteria:\n  testLayers: []\n---\n\n'),
      );
      ctx.args = [];
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'phase-check').action!(ctx);
      expect(result?.success).toBe(true);
    });
  });

  it('never writes anything — purely read-only, unlike verify/repair/run', async () => {
    const { filePath } = await createTask('accepted', (raw) => raw.replace('status: drafted', 'status: specified'));
    const before = readFileSync(filePath, 'utf8');
    ctx.args = [];
    ctx.flags = { _: [] };
    await sub(recordCommand, 'phase-check').action!(ctx);
    expect(readFileSync(filePath, 'utf8')).toBe(before);
  });
});
