/**
 * Review #3, C2 — command-bridge.ts, the adapter that lets a real CLI
 * `Command` run as an MCP tool handler with no logic duplicated.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Command, CommandContext } from '../../src/types.js';
import { runCommandAsTool } from '../../src/mcp-tools/command-bridge.js';

function makeCommand(action: Command['action']): Command {
  return { name: 'fake', description: 'fake', action };
}

describe('runCommandAsTool', () => {
  it('runs the command action and wraps a successful result as non-error tool content', async () => {
    const action = vi.fn(async () => ({ success: true, data: { id: 'REQ-001' } }));
    const result = await runCommandAsTool(makeCommand(action), { title: 'x' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text!)).toEqual({ id: 'REQ-001' });
  });

  it('wraps a failed result as error tool content, using message when there is no data', async () => {
    const action = vi.fn(async () => ({ success: false, message: 'refused' }));
    const result = await runCommandAsTool(makeCommand(action), {});
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text!)).toMatchObject({ success: false, message: 'refused' });
  });

  it('feeds a named "id" parameter into BOTH ctx.args[0] and ctx.flags.id — the same fallback every real command already uses', async () => {
    let captured: CommandContext | undefined;
    const action = vi.fn(async (ctx: CommandContext) => { captured = ctx; return { success: true }; });
    await runCommandAsTool(makeCommand(action), { id: 'TASK-001', confirm: true });
    expect(captured!.args).toEqual(['TASK-001']);
    expect(captured!.flags.id).toBe('TASK-001');
    expect(captured!.flags.confirm).toBe(true);
  });

  it('feeds a named "area" parameter the same way, for backfill tools', async () => {
    let captured: CommandContext | undefined;
    const action = vi.fn(async (ctx: CommandContext) => { captured = ctx; return { success: true }; });
    await runCommandAsTool(makeCommand(action), { area: 'src/foo/' });
    expect(captured!.args).toEqual(['src/foo/']);
    expect(captured!.flags.area).toBe('src/foo/');
  });

  it('reports an error, not a crash, when the command has no action', async () => {
    const result = await runCommandAsTool({ name: 'noop', description: 'x' }, {});
    expect(result.isError).toBe(true);
  });

  it('treats a void action result as a bare success — never crashes on it', async () => {
    const action = vi.fn(async () => { /* returns nothing, same as CommandAction's own void case */ });
    const result = await runCommandAsTool(makeCommand(action), {});
    expect(result.isError).toBe(false);
  });
});
