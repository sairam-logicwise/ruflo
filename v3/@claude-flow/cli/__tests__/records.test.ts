/**
 * T4 (agentic SDLC plan) — `ruflo record` CLI: create, show, list, validate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';
import { recordCommand } from '../src/commands/records.js';

// Real fs by default (mkdtempSync/rmSync/readFileSync/etc. below all still
// hit disk) — only writeFileSync is wrapped, so one test can force a single
// EEXIST to exercise claimAndWriteRecord's retry branch (Important 10,
// review-2026-09-21.md) without mocking the rest of the suite's real I/O.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

describe('ruflo record', () => {
  let tmp: string;
  let ctx: CommandContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ruflo-records-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('req new/show/list', () => {
    it('creates a requirement and it can be shown and listed', async () => {
      ctx.flags = { title: 'Quote a feature before building it', _: [] };
      const created = await sub(recordCommand, 'req', 'new').action!(ctx);
      expect(created?.success).toBe(true);
      const id = (created?.data as { id: string }).id;
      expect(id).toBe('REQ-001');

      ctx.args = [id];
      ctx.flags = { _: [] };
      const shown = await sub(recordCommand, 'req', 'show').action!(ctx);
      expect(shown?.success).toBe(true);
      expect((shown?.data as { valid: boolean }).valid).toBe(true);

      ctx.args = [];
      const listed = await sub(recordCommand, 'req', 'list').action!(ctx);
      expect(listed?.success).toBe(true);
      expect((listed?.data as { count: number }).count).toBe(1);
    });

    it('refuses to create a requirement with no --title', async () => {
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'req', 'new').action!(ctx);
      expect(result?.success).toBe(false);
      expect(existsSync(join(tmp, 'docs', 'requirements'))).toBe(false);
    });

    it('refusing to show a nonexistent id names the id and directory', async () => {
      ctx.args = ['REQ-999'];
      const result = await sub(recordCommand, 'req', 'show').action!(ctx);
      expect(result?.success).toBe(false);
    });

    it('assigns sequential ids across repeated creates', async () => {
      ctx.flags = { title: 'first', _: [] };
      const first = await sub(recordCommand, 'req', 'new').action!(ctx);
      ctx.flags = { title: 'second', _: [] };
      const second = await sub(recordCommand, 'req', 'new').action!(ctx);
      expect((first?.data as { id: string }).id).toBe('REQ-001');
      expect((second?.data as { id: string }).id).toBe('REQ-002');
    });

    it('retries onto the next id when the claimed one loses a concurrent create (Important 10, review-2026-09-21.md)', async () => {
      // nextId() just scans the directory, so a mock that only throws
      // EEXIST without actually creating a file would make the retry's
      // nextId() rescan an empty dir and reclaim the SAME id — not a real
      // race. Instead, simulate a concurrent process winning REQ-001: write
      // its file for real (so the retry's nextId() sees it taken and moves
      // to REQ-002), then fail this call the way {flag:'wx'} would.
      const mocked = writeFileSync as unknown as ReturnType<typeof vi.fn>;
      const real = mocked.getMockImplementation()! as typeof writeFileSync;
      mocked.mockImplementationOnce((...args: Parameters<typeof writeFileSync>) => {
        real(args[0], 'concurrent writer claimed this id first\n', 'utf8');
        const err = new Error('EEXIST: file already exists') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      });

      ctx.flags = { title: 'raced into existence', _: [] };
      const result = await sub(recordCommand, 'req', 'new').action!(ctx);
      expect(result?.success).toBe(true);
      expect((result?.data as { id: string }).id).toBe('REQ-002');
    });
  });

  // Review #3, Important 1: "the citation gate is self-serviceable" — a
  // real exploit, verified end to end: `req new --status=accepted` let a
  // brand-new requirement satisfy T16's citation-acceptance gate with
  // zero review. Fixed by removing --status from creation entirely (same
  // fix T19 already applied to `task new`) — accepted is only earned
  // through `req confirm`/`decision confirm` (T24).
  describe('req/decision new — no self-serviceable --status (Important 1)', () => {
    it('always creates a requirement as draft, even when --status=accepted is passed', async () => {
      ctx.flags = { title: 'Sneaky requirement', status: 'accepted', _: [] };
      const created = await sub(recordCommand, 'req', 'new').action!(ctx);
      expect(created?.success).toBe(true);
      const filePath = (created?.data as { path: string }).path;
      expect(readFileSync(filePath, 'utf8')).toContain('status: draft');
    });

    it('always creates a decision as draft, even when --status=accepted is passed', async () => {
      ctx.flags = { title: 'Sneaky decision', status: 'accepted', _: [] };
      const created = await sub(recordCommand, 'decision', 'new').action!(ctx);
      expect(created?.success).toBe(true);
      const filePath = (created?.data as { path: string }).path;
      expect(readFileSync(filePath, 'utf8')).toContain('status: draft');
    });
  });

  // T24: the confirmation step — "a human confirms before it counts as authoritative".
  describe('req/decision confirm — T24', () => {
    it('promotes a draft requirement to accepted, preserving provenance and confidence', async () => {
      ctx.flags = { title: 'Inferred requirement', provenance: 'agent-inferred', confidence: 0.65, _: [] };
      const created = await sub(recordCommand, 'req', 'new').action!(ctx);
      const id = (created?.data as { id: string }).id;

      ctx.args = [id];
      ctx.flags = { _: [] };
      const confirmed = await sub(recordCommand, 'req', 'confirm').action!(ctx);
      expect(confirmed?.success).toBe(true);

      const filePath = (created?.data as { path: string }).path;
      const raw = readFileSync(filePath, 'utf8');
      expect(raw).toContain('status: accepted');
      expect(raw).toContain('provenance: agent-inferred');
      expect(raw).toContain('confidence: 0.65');
    });

    it('promotes a draft decision to accepted the same way', async () => {
      ctx.flags = { title: 'Inferred decision', provenance: 'agent-inferred', confidence: 0.4, _: [] };
      const created = await sub(recordCommand, 'decision', 'new').action!(ctx);
      const id = (created?.data as { id: string }).id;

      ctx.args = [id];
      ctx.flags = { _: [] };
      const confirmed = await sub(recordCommand, 'decision', 'confirm').action!(ctx);
      expect(confirmed?.success).toBe(true);
      expect(readFileSync((created?.data as { path: string }).path, 'utf8')).toContain('status: accepted');
    });

    it('refuses to confirm a record that is already accepted', async () => {
      ctx.flags = { title: 'Already accepted', _: [] };
      const created = await sub(recordCommand, 'req', 'new').action!(ctx);
      const id = (created?.data as { id: string }).id;
      // Confirm it for real once — the only way a req reaches accepted now (Important 1).
      ctx.args = [id];
      ctx.flags = { _: [] };
      await sub(recordCommand, 'req', 'confirm').action!(ctx);

      const result = await sub(recordCommand, 'req', 'confirm').action!(ctx);
      expect(result?.success).toBe(false);
    });

    it('refuses a nonexistent id', async () => {
      ctx.args = ['REQ-999'];
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'req', 'confirm').action!(ctx);
      expect(result?.success).toBe(false);
    });

    it('refuses a missing id', async () => {
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'req', 'confirm').action!(ctx);
      expect(result?.success).toBe(false);
    });
  });

  describe('task new — the citation contract', () => {
    it('refuses to create a task with no citations, naming what is missing', async () => {
      ctx.flags = { title: 'Fix pricing bugs', _: [] };
      const result = await sub(recordCommand, 'task', 'new').action!(ctx);
      expect(result?.success).toBe(false);
      expect(existsSync(join(tmp, 'docs', 'tasks'))).toBe(false);
    });

    it('refuses a task that cites only another task, not a requirement or decision', async () => {
      // First create a real task to cite (still fails, but proves the check
      // isn't just "citations is empty" — it inspects the prefixes).
      ctx.flags = { title: 'req one', _: [] };
      await sub(recordCommand, 'req', 'new').action!(ctx);

      ctx.flags = { title: 'a task', citations: 'REQ-001', _: [] };
      const firstTask = await sub(recordCommand, 'task', 'new').action!(ctx);
      expect(firstTask?.success).toBe(true);
      const firstId = (firstTask?.data as { id: string }).id;

      ctx.flags = { title: 'depends on the first task only', citations: firstId, _: [] };
      const result = await sub(recordCommand, 'task', 'new').action!(ctx);
      expect(result?.success).toBe(false);
    });

    it('always creates a task as drafted, even if a status flag is passed (T19: no API to set Done directly)', async () => {
      // Real bug found via live testing, not this suite: --status=done
      // (equals syntax) used to slip through to the frontmatter builder
      // and create a task already "done", bypassing verification (T19)
      // entirely. `ctx.flags` below mimics the CLI's equals-syntax parse
      // result directly, since sub()-driven tests build ctx by hand.
      ctx.flags = { title: 'req one', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      ctx.flags = { title: 'sneaky task', citations: reqId, status: 'done', _: [] };
      const result = await sub(recordCommand, 'task', 'new').action!(ctx);
      expect(result?.success).toBe(true);
      const { path } = result?.data as { path: string };
      expect(readFileSync(path, 'utf8')).toContain('status: drafted');
    });

    it('creates a task when it cites a requirement, and the file validates', async () => {
      ctx.flags = { title: 'req one', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      ctx.flags = { title: 'Fix pricing bugs', citations: reqId, priority: 'p1', _: [] };
      const result = await sub(recordCommand, 'task', 'new').action!(ctx);
      expect(result?.success).toBe(true);
      const { path } = result?.data as { path: string };
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, 'utf8');
      expect(raw).toContain('priority: p1');
      expect(raw).toContain(reqId);
    });

    it('creates a task when it cites a decision instead of a requirement', async () => {
      ctx.flags = { title: 'a decision', _: [] };
      const dec = await sub(recordCommand, 'decision', 'new').action!(ctx);
      const decId = (dec?.data as { id: string }).id;

      ctx.flags = { title: 'follows from the decision', citations: decId, _: [] };
      const result = await sub(recordCommand, 'task', 'new').action!(ctx);
      expect(result?.success).toBe(true);
    });
  });

  describe('ruflo record validate', () => {
    it('reports success on an empty (no records) tree', async () => {
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'validate').action!(ctx);
      expect(result?.success).toBe(true);
      expect((result?.data as { total: number }).total).toBe(0);
    });

    it('reports success when every created record validates', async () => {
      ctx.flags = { title: 'req one', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;
      ctx.flags = { title: 'a task', citations: reqId, _: [] };
      await sub(recordCommand, 'task', 'new').action!(ctx);

      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'validate').action!(ctx);
      expect(result?.success).toBe(true);
      expect((result?.data as { total: number }).total).toBe(2);
    });

    it('fails and reports which file when a hand-edited record breaks the schema', async () => {
      ctx.flags = { title: 'req one', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const { path } = req?.data as { path: string };

      // Simulate a hand-edit that breaks validation (bad status value).
      const raw = readFileSync(path, 'utf8').replace('status: draft', 'status: in-review');
      writeFileSync(path, raw);

      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'validate').action!(ctx);
      expect(result?.success).toBe(false);
      const failures = (result?.data as { failures: Array<{ path: string }> }).failures;
      expect(failures[0].path).toBe(path);
    });

    it('--fix rehashes a stale contentHash and makes the record valid again (B3, review-2026-09-22.md)', async () => {
      ctx.flags = { title: 'req one', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const { path } = req?.data as { path: string };

      // Hand-edit the body only — contentHash goes stale, everything else stays valid.
      const raw = readFileSync(path, 'utf8').replace('# req one', '# req one, hand-edited');
      writeFileSync(path, raw);

      ctx.flags = { _: [] };
      const before = await sub(recordCommand, 'validate').action!(ctx);
      expect(before?.success).toBe(false);

      ctx.flags = { fix: true, _: [] };
      const fixResult = await sub(recordCommand, 'validate').action!(ctx);
      expect(fixResult?.success).toBe(true);
      expect((fixResult?.data as { fixed: string[] }).fixed).toEqual([path]);

      ctx.flags = { _: [] };
      const after = await sub(recordCommand, 'validate').action!(ctx);
      expect(after?.success).toBe(true);

      expect(readFileSync(path, 'utf8')).toContain('# req one, hand-edited');
    });

    it('--fix does not touch a genuine schema violation, only a hash mismatch', async () => {
      ctx.flags = { title: 'req one', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const { path } = req?.data as { path: string };

      const raw = readFileSync(path, 'utf8').replace('status: draft', 'status: in-review');
      writeFileSync(path, raw);

      ctx.flags = { fix: true, _: [] };
      const result = await sub(recordCommand, 'validate').action!(ctx);
      expect(result?.success).toBe(false);
      expect((result?.data as { fixed: string[] }).fixed).toEqual([]);
      expect(readFileSync(path, 'utf8')).toContain('status: in-review'); // unchanged
    });
  });
});
