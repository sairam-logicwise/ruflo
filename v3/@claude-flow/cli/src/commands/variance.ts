/**
 * `ruflo variance` — T14, agentic SDLC plan (tasks/plan.md). Quoted
 * versus actual, per task and in aggregate, with the hit rate and its
 * trend over time. Built from T6's own real decomposition of REQ-003
 * (TASK-029/030/031) as the literal implementation plan.
 *
 * @module commands/variance
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { buildVarianceReport, type VarianceReport } from '../ruvector/estimator/variance.js';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printReport(report: VarianceReport): void {
  // C5: the caveat, when there is one, prints BEFORE the headline number —
  // the whole point is that a bare hit rate was the first, and only, thing
  // a stakeholder used to see.
  if (report.hitRateCaveat) {
    output.writeln(`⚠ ${report.hitRateCaveat}`);
  }
  output.writeln(`Variance: ${report.perTask.filter((t) => t.hit).length}/${report.sampleSize} within quoted range (${pct(report.hitRate)} hit rate)`);
  if (report.sampleSize === 0) {
    output.writeln('  No task carries both an estimate and actuals yet — nothing to compare.');
  }
  output.writeln('Per-task:');
  for (const t of report.perTask) {
    output.writeln(`  ${t.taskId} (${t.title}): quoted ${t.lowTokens}-${t.highTokens}, actual ${t.actualTokens} ($${t.actualCostUsd.toFixed(4)}) — ${t.hit ? 'HIT' : 'MISS'} [${t.actualsSource}]`);
  }
  if (report.trend.length > 0) {
    output.writeln('Trend (chronological, cumulative — a small early sample reads as exactly that):');
    for (const p of report.trend) {
      output.writeln(`  ${p.taskId} (${p.createdAt}): ${p.hit ? 'hit' : 'miss'} — cumulative ${pct(p.cumulativeHitRate)} over ${p.cumulativeSampleSize} task(s)`);
    }
  }
  if (report.skipped.length > 0) {
    output.writeln(`Skipped (excluded from the sample above, not dropped silently): ${report.skipped.length}`);
    for (const s of report.skipped) output.writeln(`  ${s.taskId} (${s.title}): ${s.reason}`);
  }
}

const varianceCommand: Command = {
  name: 'variance',
  description: 'Quoted versus actual across delivered tasks (T14) — per-task comparison, aggregate hit rate, and trend over time.',
  options: [
    { name: 'json', description: 'Machine-readable JSON output', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const report = buildVarianceReport(ctx.cwd);
    if (ctx.flags.json === true) {
      output.printJson(report);
    } else {
      printReport(report);
    }
    return { success: true, data: report };
  },
};

export default varianceCommand;
