/**
 * `ruflo quote <requirement-id>` — T11, agentic SDLC plan (tasks/plan.md).
 * Rolls estimates up across a requirement's decomposed tasks (T10's
 * `predictTokens`, via `estimator/quote.ts`), prices the result against
 * `model-prices.ts`, and prints a stakeholder-readable range — never a
 * point estimate (AD-6). `--backlog` rolls up across every requirement on
 * disk instead of one id; `--json` switches to the machine-readable shape.
 *
 * Built from TASK-017/018/020's own real bodies (T6's real decomposition
 * of REQ-001, this task's own requirement).
 *
 * @module commands/quote
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { quoteRequirement, quoteBacklog, listAllRequirementIds, type Quote, type BacklogQuote, type QuoteOptions } from '../ruvector/estimator/quote.js';
import { UnknownModelPriceError } from '../ruvector/model-prices.js';

/** C3: undefined means no measured cost data exists yet — never printed as $0.00 or omitted silently. */
function formatCostRange(low: number | undefined, high: number | undefined): string {
  if (low === undefined || high === undefined) return 'no measured cost data yet';
  return `$${low.toFixed(2)}-$${high.toFixed(2)}`;
}

/** Fixed 'en-US' grouping — plain toLocaleString() follows the host's locale (verified: an en-IN host renders 153562 as "1,53,562"), which would make this output non-deterministic across machines. */
function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

function printQuote(q: Quote): void {
  output.writeln(`${q.requirementId} — ${q.requirementTitle}`);
  output.writeln(`  Range: ${formatTokens(q.lowTokens)}-${formatTokens(q.highTokens)} tokens (${formatCostRange(q.lowCostUsd, q.highCostUsd)})`);
  if (q.assumptions.costCaveat) output.writeln(`  ⚠ ${q.assumptions.costCaveat}`);
  output.writeln(`  Confidence: ${q.confidence.toFixed(2)} (weakest of ${q.perTask.length} estimated task(s))`);
  output.writeln(`  Assumptions: retry multiplier ${q.assumptions.retryMultiplier}x, corpus size ${q.assumptions.corpusSize}, ${q.assumptions.neighborCount} neighbour(s), priced against "${q.assumptions.priceId}" (${q.assumptions.pricingModel})`);
  output.writeln(`  Per-task breakdown:`);
  for (const t of q.perTask) {
    output.writeln(`    ${t.taskId} (${t.title}): ${formatTokens(t.lowTokens)}-${formatTokens(t.highTokens)} tokens, confidence ${t.confidence.toFixed(2)}`);
  }
  if (q.unpredictedTasks.length > 0) {
    output.writeln(`  Not estimated (excluded from the sum above, not dropped silently):`);
    for (const u of q.unpredictedTasks) {
      output.writeln(`    ${u.taskId} (${u.title}): ${u.reason}`);
    }
  }
}

function printBacklog(b: BacklogQuote): void {
  output.writeln(`Backlog quote across ${b.requirementQuotes.length} requirement(s):`);
  output.writeln(`  Range: ${formatTokens(b.lowTokens)}-${formatTokens(b.highTokens)} tokens (${formatCostRange(b.lowCostUsd, b.highCostUsd)})`);
  if (b.requirementsWithoutMeasuredCost.length > 0) {
    output.writeln(`  ⚠ excluded from the cost total above (no measured cost data): ${b.requirementsWithoutMeasuredCost.join(', ')}`);
  }
  output.writeln(`  Confidence: ${b.confidence.toFixed(2)} (weakest of ${b.requirementQuotes.length} requirement quote(s))`);
  output.writeln('');
  for (const q of b.requirementQuotes) printQuote(q);
  if (b.skippedRequirements.length > 0) {
    output.writeln('');
    output.writeln('Skipped (excluded from the sum above, not dropped silently):');
    for (const s of b.skippedRequirements) output.writeln(`  ${s.requirementId}: ${s.reason}`);
  }
}

const quoteCommand: Command = {
  name: 'quote',
  description: "Roll up T10's token/cost estimate across a requirement's decomposed tasks (T11) — a range with a confidence level, never a point estimate.",
  options: [
    { name: 'backlog', description: 'Quote every requirement on disk instead of one id', type: 'boolean', default: false },
    { name: 'json', description: 'Machine-readable JSON output', type: 'boolean', default: false },
    { name: 'k', description: 'Neighbours considered per task (forwarded to predictTokens, default 5)', type: 'number' },
    { name: 'retry-multiplier', description: 'Retry/repair buffer on the high end of each task range (default 1.3)', type: 'number' },
    { name: 'price-id', description: 'Model id to price against (model-prices.ts, default "sonnet")', type: 'string' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const opts: QuoteOptions = {
      ...(ctx.flags.k !== undefined ? { k: ctx.flags.k as number } : {}),
      ...((ctx.flags.retryMultiplier ?? ctx.flags['retry-multiplier']) !== undefined
        ? { retryMultiplier: (ctx.flags.retryMultiplier ?? ctx.flags['retry-multiplier']) as number }
        : {}),
      ...((ctx.flags.priceId ?? ctx.flags['price-id']) !== undefined ? { priceId: (ctx.flags.priceId ?? ctx.flags['price-id']) as string } : {}),
    };
    const asJson = ctx.flags.json === true;

    try {
      if (ctx.flags.backlog === true) {
        const ids = ctx.args.length > 0 ? ctx.args : listAllRequirementIds(ctx.cwd);
        const backlogQuote = quoteBacklog(ctx.cwd, ids, opts);
        if (asJson) {
          output.printJson(backlogQuote);
        } else {
          printBacklog(backlogQuote);
        }
        return { success: true, data: backlogQuote };
      }

      const requirementId = ctx.args[0];
      if (!requirementId) {
        output.printError('Usage: ruflo quote <requirement-id> (or --backlog to quote every requirement)');
        return { success: false, exitCode: 1 };
      }

      const result = quoteRequirement(ctx.cwd, requirementId, opts);
      if (!result.ok) {
        output.printError(result.reason);
        return { success: false, exitCode: 1 };
      }

      if (asJson) {
        output.printJson(result.quote);
      } else {
        printQuote(result.quote);
      }
      return { success: true, data: result.quote };
    } catch (err) {
      if (err instanceof UnknownModelPriceError) {
        output.printError(err.message);
        return { success: false, exitCode: 1 };
      }
      throw err;
    }
  },
};

export default quoteCommand;
