/**
 * command-bridge.ts — Review #3, C2 (agentic SDLC plan, tasks/plan.md).
 *
 * "The record is the gate, not the prompt" — enforced in the MCP client
 * path so it survives a tool switch (HANDOVER.md §3). That path was never
 * built for this plan's own commands: `mcp-client.ts` registered exactly
 * one tool (`quoteTools`, T11) out of the whole `record`/`run`/
 * `phase-check`/`decompose`/`backfill` surface — confirmed by listing
 * `mcp-tools/`, which held one relevant file. A Cursor or Codex agent had
 * nothing to be gated by; it simply never called the command.
 *
 * Rather than re-implement each command's logic a second time for MCP
 * (two copies drift, and this plan has already paid for that mistake
 * once — see model-prices.ts's own history), this module adapts an
 * EXISTING `Command`'s own `action` into an MCP tool handler directly.
 * One real implementation, two entry points — the same principle T11's
 * `quote-tools.ts` already established for `estimator/quote.ts`,
 * generalized to every command this plan built.
 *
 * @module mcp-tools/command-bridge
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import type { MCPToolResult } from './types.js';
import { getProjectCwd } from './types.js';

/**
 * MCP tool input arrives as a flat object of named parameters — there is
 * no positional-argument concept over MCP the way a CLI has `ctx.args`.
 * Every bridged tool's `inputSchema` therefore names the id/area/etc a
 * command would otherwise take positionally as an explicit parameter
 * (e.g. `id`), and this adapter feeds it into BOTH `ctx.args[0]` and
 * `ctx.flags.id` — real commands already accept either (every command
 * built in this plan does `ctx.args[0] || ctx.flags.id`, the same
 * fallback established from T19 onward), so this needs no per-command
 * special-casing.
 */
function buildContext(input: Record<string, unknown>): CommandContext {
  const positionalKeys = ['id', 'area'] as const;
  const args: string[] = [];
  for (const key of positionalKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) args.push(value);
  }
  const flags: CommandContext['flags'] = { ...input, _: [] } as CommandContext['flags'];
  return { args, flags, cwd: getProjectCwd(), interactive: false };
}

function toToolResult(result: CommandResult): MCPToolResult {
  const payload = result.data !== undefined ? result.data : { success: result.success, message: result.message };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: !result.success,
  };
}

/**
 * Runs a real `Command`'s own `action` — the identical code path the CLI
 * itself runs, including every existing safety gate (dry-run defaults,
 * `--confirm`/`--yes` requirements, refuse-loud preconditions). An MCP
 * caller inherits all of it automatically: nothing here loosens or
 * bypasses anything the CLI already enforces.
 */
export async function runCommandAsTool(command: Command, input: Record<string, unknown>): Promise<MCPToolResult> {
  if (!command.action) {
    return { content: [{ type: 'text', text: `"${command.name}" has no action to run` }], isError: true };
  }
  const result = await command.action(buildContext(input));
  return toToolResult(result ?? { success: true });
}
