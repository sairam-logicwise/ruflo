/**
 * `ruflo backfill` — T23, agentic SDLC plan (tasks/plan.md). CLI surface
 * over the mechanical, zero-cost area summary (`../backfill/area-summary.ts`).
 * Backfill runs one area at a time (decision D1) — this command always
 * takes exactly one area path prefix, never "the whole repo".
 *
 * @module commands/backfill
 */

import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { summarizeArea } from '../backfill/area-summary.js';

const backfillSummarizeCommand: Command = {
  name: 'summarize',
  description: 'Summarize one area of the codebase from the Graphify graph — modules, dependencies, entry points, test presence. No model calls, no token cost.',
  options: [
    { name: 'area', description: 'Path prefix to summarize, e.g. v3/@claude-flow/cli/src/ruvector/', type: 'string' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const area = ctx.args[0] || (ctx.flags.area as string);
    if (!area) {
      output.printError('Usage: ruflo backfill summarize <area-path-prefix>');
      return { success: false, exitCode: 1 };
    }
    const graphPath = join(ctx.cwd, 'graphify-out', 'graph.json');
    try {
      const summary = summarizeArea(area, graphPath);
      output.printJson(summary);
      return { success: true, data: summary };
    } catch (err) {
      output.printError('Could not summarize area', err instanceof Error ? err.message : String(err));
      return { success: false, exitCode: 1 };
    }
  },
};

const backfillCommand: Command = {
  name: 'backfill',
  description: 'Mechanical backfill pass over the existing codebase (T23, agentic SDLC plan) — one area at a time, no model calls',
  subcommands: [backfillSummarizeCommand],
  action: backfillSummarizeCommand.action,
};

export default backfillCommand;
