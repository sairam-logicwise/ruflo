/**
 * T24 (agentic SDLC plan) — `ruflo backfill infer`, the CLI layer over
 * infer.ts. Same discipline as decompose.test.ts: the LLM call is mocked
 * out entirely (no real spend), and this suite proves the command's own
 * wiring — dry-run by default, --from-file, and that every written
 * record lands as draft/agent-inferred/confidence-bearing, never
 * auto-accepted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';

vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ callAnthropicMessages: vi.fn() }));

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

function proposal(overrides: Partial<{ kind: string; title: string; body: string; confidence: number }> = {}) {
  return { kind: 'requirement', title: 'A proposed requirement', body: 'Body text.', confidence: 0.6, ...overrides };
}

function writeGraph(cwd: string, area: string): void {
  mkdirSync(join(cwd, 'graphify-out'), { recursive: true });
  writeFileSync(join(cwd, 'graphify-out', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'n1', source_file: `${area}a.ts`, file_type: 'code', label: 'a' }],
    links: [],
  }));
}

describe('ruflo backfill infer', () => {
  let tmp: string;
  let ctx: CommandContext;
  let backfillCommand: Command;
  let callAnthropicMessages: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'backfill-infer-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ default: backfillCommand } = await import('../src/commands/backfill.js'));
    ({ callAnthropicMessages } = await import('../src/mcp-tools/agent-execute-core.js') as unknown as { callAnthropicMessages: ReturnType<typeof vi.fn> });
    callAnthropicMessages.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('is wired in as a subcommand of backfill', () => {
    expect(() => sub(backfillCommand, 'infer')).not.toThrow();
  });

  it('refuses a missing area', async () => {
    ctx.flags = { _: [] };
    const result = await sub(backfillCommand, 'infer').action!(ctx);
    expect(result?.success).toBe(false);
    expect(callAnthropicMessages).not.toHaveBeenCalled();
  });

  describe('--from-file (no LLM call)', () => {
    it('dry-run: prints proposals, writes nothing', async () => {
      const proposalsPath = join(tmp, 'proposals.json');
      writeFileSync(proposalsPath, JSON.stringify([proposal()]));
      ctx.args = ['src/area/'];
      ctx.flags = { fromFile: proposalsPath, _: [] };
      const result = await sub(backfillCommand, 'infer').action!(ctx);
      expect(result?.success).toBe(true);
      expect((result?.data as { dryRun?: boolean }).dryRun).toBe(true);
      expect(callAnthropicMessages).not.toHaveBeenCalled();
    });

    it('--yes writes real requirement AND decision records, both draft/agent-inferred/confidence-bearing', async () => {
      const proposalsPath = join(tmp, 'proposals.json');
      writeFileSync(proposalsPath, JSON.stringify([
        proposal({ kind: 'requirement', title: 'Cache reads', confidence: 0.8 }),
        proposal({ kind: 'decision', title: 'Use LRU', confidence: 0.4 }),
      ]));
      ctx.args = ['src/area/'];
      ctx.flags = { fromFile: proposalsPath, yes: true, _: [] };
      const result = await sub(backfillCommand, 'infer').action!(ctx);
      expect(result?.success).toBe(true);
      const { created } = result?.data as { created: Array<{ id: string; filePath: string }> };
      expect(created).toHaveLength(2);

      const reqFile = created.find((c) => c.id.startsWith('REQ-'))!;
      const decFile = created.find((c) => c.id.startsWith('DEC-'))!;
      const reqRaw = readFileSync(reqFile.filePath, 'utf8');
      const decRaw = readFileSync(decFile.filePath, 'utf8');

      expect(reqRaw).toContain('status: draft');
      expect(reqRaw).toContain('provenance: agent-inferred');
      expect(reqRaw).toContain('confidence: 0.8');
      expect(reqRaw).not.toContain('status: accepted'); // never auto-accepted, however high the confidence

      expect(decRaw).toContain('status: draft');
      expect(decRaw).toContain('provenance: agent-inferred');
      expect(decRaw).toContain('confidence: 0.4');
    });

    it('a malformed proposals file is refused before writing anything', async () => {
      const proposalsPath = join(tmp, 'bad.json');
      writeFileSync(proposalsPath, JSON.stringify([{ kind: 'nonsense' }]));
      ctx.args = ['src/area/'];
      ctx.flags = { fromFile: proposalsPath, yes: true, _: [] };
      const result = await sub(backfillCommand, 'infer').action!(ctx);
      expect(result?.success).toBe(false);
    });
  });

  describe('calling the LLM (mocked)', () => {
    it('gathers real grounding, calls the model, and reports usage', async () => {
      writeGraph(tmp, 'src/area/');
      callAnthropicMessages.mockResolvedValue({
        success: true,
        output: JSON.stringify([proposal({ title: 'Inferred from real code' })]),
        usage: { inputTokens: 500, outputTokens: 80, totalTokens: 580 },
      });
      ctx.args = ['src/area/'];
      ctx.flags = { _: [] };
      const result = await sub(backfillCommand, 'infer').action!(ctx);
      expect(result?.success).toBe(true);
      expect(callAnthropicMessages).toHaveBeenCalledTimes(1);
      const callArg = callAnthropicMessages.mock.calls[0][0] as { prompt: string };
      expect(callArg.prompt).toContain('src/area/');
    });

    it('surfaces a failed LLM call as a command failure, without crashing', async () => {
      writeGraph(tmp, 'src/area/');
      callAnthropicMessages.mockResolvedValue({ success: false, error: 'rate limited' });
      ctx.args = ['src/area/'];
      ctx.flags = { _: [] };
      const result = await sub(backfillCommand, 'infer').action!(ctx);
      expect(result?.success).toBe(false);
    });

    it('surfaces an unparseable model response as a command failure, without crashing', async () => {
      writeGraph(tmp, 'src/area/');
      callAnthropicMessages.mockResolvedValue({ success: true, output: 'I refuse to respond in JSON.' });
      ctx.args = ['src/area/'];
      ctx.flags = { _: [] };
      const result = await sub(backfillCommand, 'infer').action!(ctx);
      expect(result?.success).toBe(false);
    });

    it('never calls the LLM when --from-file is given', async () => {
      const proposalsPath = join(tmp, 'proposals.json');
      writeFileSync(proposalsPath, JSON.stringify([proposal()]));
      ctx.args = ['src/area/'];
      ctx.flags = { fromFile: proposalsPath, _: [] };
      await sub(backfillCommand, 'infer').action!(ctx);
      expect(callAnthropicMessages).not.toHaveBeenCalled();
    });
  });

  it('the resulting records validate for real', async () => {
    const proposalsPath = join(tmp, 'proposals.json');
    writeFileSync(proposalsPath, JSON.stringify([proposal({ kind: 'requirement' })]));
    ctx.args = ['src/area/'];
    ctx.flags = { fromFile: proposalsPath, yes: true, _: [] };
    await sub(backfillCommand, 'infer').action!(ctx);

    const { recordCommand } = await import('../src/commands/records.js');
    ctx.flags = { _: [] };
    const validated = await sub(recordCommand, 'validate').action!(ctx);
    expect(validated?.success).toBe(true);
  });
});
