/**
 * T6 (agentic SDLC plan) — requirement decomposition: prompt building,
 * response parsing, graph-grounding, and the `ruflo record req decompose` CLI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';
import {
  buildDecomposePrompt,
  parseProposals,
  groundProposals,
  MIN_TASKS,
  MAX_TASKS,
  type TaskProposal,
} from '../src/commands/decompose.js';

function proposal(overrides: Partial<TaskProposal> = {}): TaskProposal {
  return { title: 'Fix the thing', body: 'Body text.', files: [], ...overrides };
}

describe('buildDecomposePrompt', () => {
  it('includes the requirement id, title, and body', () => {
    const { user } = buildDecomposePrompt('REQ-001', 'Quote a feature', 'Body of the requirement.', []);
    expect(user).toContain('REQ-001');
    expect(user).toContain('Quote a feature');
    expect(user).toContain('Body of the requirement.');
  });

  it('lists grounding files when present', () => {
    const { user } = buildDecomposePrompt('REQ-001', 'x', 'y', ['src/a.ts', 'src/b.ts']);
    expect(user).toContain('src/a.ts');
    expect(user).toContain('src/b.ts');
  });

  it('tells the model not to invent paths when no grounding files were found', () => {
    const { user } = buildDecomposePrompt('REQ-001', 'x', 'y', []);
    expect(user.toLowerCase()).toContain('no strongly relevant');
    expect(user.toLowerCase()).toContain('inventing paths');
  });

  it('states the task count range', () => {
    const { user } = buildDecomposePrompt('REQ-001', 'x', 'y', []);
    expect(user).toContain(`${MIN_TASKS}`);
    expect(user).toContain(`${MAX_TASKS}`);
  });
});

describe('parseProposals', () => {
  function validArray(n = 5): unknown[] {
    return Array.from({ length: n }, (_, i) => ({ title: `Task ${i}`, body: `Body ${i}`, files: [] }));
  }

  it('parses a valid JSON array', () => {
    const result = parseProposals(JSON.stringify(validArray()));
    expect('proposals' in result).toBe(true);
    if ('proposals' in result) expect(result.proposals).toHaveLength(5);
  });

  it('strips a markdown code fence the model added despite instructions', () => {
    const fenced = '```json\n' + JSON.stringify(validArray()) + '\n```';
    const result = parseProposals(fenced);
    expect('proposals' in result).toBe(true);
  });

  it('rejects invalid JSON', () => {
    const result = parseProposals('not json {{{');
    expect('error' in result).toBe(true);
  });

  it('rejects a non-array response', () => {
    const result = parseProposals(JSON.stringify({ title: 'not an array' }));
    expect('error' in result).toBe(true);
  });

  it(`rejects fewer than ${MIN_TASKS} tasks`, () => {
    const result = parseProposals(JSON.stringify(validArray(MIN_TASKS - 1)));
    expect('error' in result).toBe(true);
  });

  it(`rejects more than ${MAX_TASKS} tasks`, () => {
    const result = parseProposals(JSON.stringify(validArray(MAX_TASKS + 1)));
    expect('error' in result).toBe(true);
  });

  it('rejects an item missing a title', () => {
    const arr = validArray();
    (arr[0] as Record<string, unknown>).title = '';
    const result = parseProposals(JSON.stringify(arr));
    expect('error' in result).toBe(true);
  });

  it('rejects an item missing a body', () => {
    const arr = validArray();
    delete (arr[0] as Record<string, unknown>).body;
    const result = parseProposals(JSON.stringify(arr));
    expect('error' in result).toBe(true);
  });

  it('filters non-string entries out of files rather than rejecting the whole item', () => {
    const arr = validArray(MIN_TASKS);
    (arr[0] as Record<string, unknown>).files = ['src/a.ts', 42, null, 'src/b.ts'];
    const result = parseProposals(JSON.stringify(arr));
    expect('proposals' in result).toBe(true);
    if ('proposals' in result) expect(result.proposals[0].files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('groundProposals', () => {
  it('keeps a file reference that is in the grounding list', () => {
    const result = groundProposals([proposal({ files: ['src/a.ts'] })], ['src/a.ts', 'src/b.ts']);
    expect(result[0].files).toEqual(['src/a.ts']);
  });

  it('drops a hallucinated file reference not in the grounding list', () => {
    // Acceptance criterion: "tasks reference real files or modules from
    // the graph" — a path the model invented is silently dropped, never
    // written into a record as if it were grounded.
    const result = groundProposals([proposal({ files: ['src/a.ts', 'src/made-up-file.ts'] })], ['src/a.ts']);
    expect(result[0].files).toEqual(['src/a.ts']);
  });

  it('leaves title/body untouched', () => {
    const result = groundProposals([proposal({ title: 'T', body: 'B' })], []);
    expect(result[0].title).toBe('T');
    expect(result[0].body).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// CLI: `ruflo record req decompose`
// ---------------------------------------------------------------------------

vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({
  callAnthropicMessages: vi.fn(),
}));

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

describe('ruflo record req decompose', () => {
  let tmp: string;
  let ctx: CommandContext;
  let recordCommand: Command;
  let callAnthropicMessages: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'decompose-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ recordCommand } = await import('../src/commands/records.js'));
    ({ callAnthropicMessages } = await import('../src/mcp-tools/agent-execute-core.js') as unknown as { callAnthropicMessages: ReturnType<typeof vi.fn> });
    callAnthropicMessages.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('is wired in as a subcommand of req', () => {
    expect(() => sub(recordCommand, 'req', 'decompose')).not.toThrow();
  });

  it('refuses a missing id', async () => {
    ctx.flags = { _: [] };
    const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);
    expect(result?.success).toBe(false);
  });

  it('refuses a nonexistent requirement id', async () => {
    ctx.flags = { _: [] };
    ctx.args = ['REQ-999'];
    const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);
    expect(result?.success).toBe(false);
  });

  describe('--from-file (no LLM call)', () => {
    it('dry-run: prints proposals, writes nothing', async () => {
      ctx.flags = { title: 'Quote a feature', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      const proposalsPath = join(tmp, 'proposals.json');
      writeFileSync(proposalsPath, JSON.stringify([
        proposal({ title: 'A', body: 'a' }),
        proposal({ title: 'B', body: 'b' }),
        proposal({ title: 'C', body: 'c' }),
      ]));

      ctx.args = [reqId];
      ctx.flags = { 'from-file': proposalsPath, _: [] };
      const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);
      expect(result?.success).toBe(true);
      expect((result?.data as { dryRun: boolean }).dryRun).toBe(true);
      expect(existsSync(join(tmp, 'docs', 'tasks'))).toBe(false);
    });

    it('accepts the camelCase flag form too (real bug, review before merging: the actual CLI flag parser normalizes --from-file to ctx.flags.fromFile, not ctx.flags["from-file"] — caught only by testing against the real compiled binary, not this unit test suite)', async () => {
      ctx.flags = { title: 'Quote a feature', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      const proposalsPath = join(tmp, 'proposals.json');
      writeFileSync(proposalsPath, JSON.stringify([
        proposal({ title: 'A', body: 'a' }),
        proposal({ title: 'B', body: 'b' }),
        proposal({ title: 'C', body: 'c' }),
      ]));

      ctx.args = [reqId];
      ctx.flags = { fromFile: proposalsPath, _: [] }; // camelCase, not 'from-file'
      const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);
      expect(result?.success).toBe(true);
      expect((result?.data as { dryRun: boolean }).dryRun).toBe(true);
    });

    it('--yes writes each proposal as a task record citing the requirement', async () => {
      ctx.flags = { title: 'Quote a feature', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      const proposalsPath = join(tmp, 'proposals.json');
      writeFileSync(proposalsPath, JSON.stringify([
        proposal({ title: 'Task A', body: 'Do A.' }),
        proposal({ title: 'Task B', body: 'Do B.' }),
        proposal({ title: 'Task C', body: 'Do C.' }),
      ]));

      ctx.args = [reqId];
      ctx.flags = { 'from-file': proposalsPath, yes: true, _: [] };
      const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);
      expect(result?.success).toBe(true);
      const created = (result?.data as { created: Array<{ id: string; filePath: string }> }).created;
      expect(created).toHaveLength(3);

      for (const c of created) {
        const raw = readFileSync(c.filePath, 'utf8');
        expect(raw).toContain(`citations:\n  - ${reqId}`);
        expect(raw).toContain('provenance: agent-inferred');
      }

      ctx.flags = { _: [] };
      const validated = await sub(recordCommand, 'validate').action!(ctx);
      expect(validated?.success).toBe(true);
    });

    it('drops a hallucinated file reference even when it comes from --from-file', async () => {
      const graphDir = join(tmp, 'graphify-out');
      mkdirSync(graphDir, { recursive: true });
      writeFileSync(join(graphDir, 'graph.json'), JSON.stringify({
        nodes: [{ label: 'pricing.ts', norm_label: 'pricing.ts', source_file: 'src/pricing.ts', file_type: 'code' }],
      }));

      ctx.flags = { title: 'Fix the pricing bug', body: 'The pricing calculation is wrong.', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      const proposalsPath = join(tmp, 'proposals.json');
      writeFileSync(proposalsPath, JSON.stringify([
        proposal({ title: 'Task A', body: 'Do A.', files: ['src/pricing.ts', 'src/does-not-exist.ts'] }),
        proposal({ title: 'Task B', body: 'Do B.' }),
        proposal({ title: 'Task C', body: 'Do C.' }),
      ]));

      ctx.args = [reqId];
      ctx.flags = { 'from-file': proposalsPath, yes: true, _: [] };
      const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);
      const created = (result?.data as { created: Array<{ id: string; filePath: string }> }).created;
      const taskA = readFileSync(created[0].filePath, 'utf8');
      expect(taskA).toContain('src/pricing.ts');
      expect(taskA).not.toContain('src/does-not-exist.ts');
    });
  });

  describe('live LLM call (mocked)', () => {
    it('calls the LLM with a grounded prompt and writes the parsed proposals', async () => {
      callAnthropicMessages.mockResolvedValue({
        success: true,
        output: JSON.stringify([
          proposal({ title: 'Task A', body: 'Do A.' }),
          proposal({ title: 'Task B', body: 'Do B.' }),
          proposal({ title: 'Task C', body: 'Do C.' }),
        ]),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      ctx.flags = { title: 'Quote a feature', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      ctx.args = [reqId];
      ctx.flags = { yes: true, _: [] };
      const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);

      expect(callAnthropicMessages).toHaveBeenCalledTimes(1);
      const callArg = callAnthropicMessages.mock.calls[0][0];
      expect(callArg.prompt).toContain(reqId);
      expect(result?.success).toBe(true);
      expect((result?.data as { created: unknown[] }).created).toHaveLength(3);
    });

    it('fails cleanly when the LLM call itself fails', async () => {
      callAnthropicMessages.mockResolvedValue({ success: false, error: 'rate limited' });

      ctx.flags = { title: 'Quote a feature', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      ctx.args = [reqId];
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);
      expect(result?.success).toBe(false);
    });

    it('fails cleanly when the LLM response cannot be parsed as proposals', async () => {
      callAnthropicMessages.mockResolvedValue({ success: true, output: 'I refuse to respond in JSON.' });

      ctx.flags = { title: 'Quote a feature', _: [] };
      const req = await sub(recordCommand, 'req', 'new').action!(ctx);
      const reqId = (req?.data as { id: string }).id;

      ctx.args = [reqId];
      ctx.flags = { _: [] };
      const result = await sub(recordCommand, 'req', 'decompose').action!(ctx);
      expect(result?.success).toBe(false);
    });
  });
});
