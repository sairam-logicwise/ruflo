/**
 * `ruflo record task repair <id>` — T20, agentic SDLC plan (tasks/plan.md).
 *
 * Wraps repair-loop.ts's bounded tdd-repair.mjs loop onto a task T19's
 * `task verify` blocked with a red test result. Refuses on anything else —
 * a task blocked for a different reason (e.g. missing doneCriteria) has no
 * failing test to hand the headless repair agent.
 *
 * Two possible endings, both written back through T19's own
 * `applyTaskTransition`:
 *   - repaired: re-verified with T19's trusted runner (not tdd-repair.mjs's
 *     own self-report) via `verifyTask`, transitioning verifying -> done or
 *     verifying -> blocked exactly as `task verify` would on its own
 *   - not repaired: stays `blocked`, with the repair loop's stop reason and
 *     last failing output folded into the reason, so exhaustion leaves a
 *     diagnosable trail rather than a dead end (plan.md's acceptance
 *     criterion for this task)
 *
 * `--confirm` is required to actually spend anything — repair-loop.ts's own
 * gate, mirrored here rather than defaulted away, since this command can
 * spawn a real billed `claude -p` process. Without it, prints the plan and
 * exits 0, spending nothing.
 *
 * @module commands/task-repair
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { parseRecordFile, serializeRecordFile, validateRecord, computeContentHash, type Task, type TransitionResult } from '@claude-flow/docops';
import { kindDir, findRecordPath, formatValidationError, applyTaskTransition, buildRepairActuals, buildVerificationReceipt, finalizeContentHash } from './records-io.js';
import { verifyTask, resolveTestCommand, type TestRunResult } from '../ruvector/test-runner.js';
import { runRepairLoop } from '../ruvector/repair-loop.js';

const taskRepairCommand: Command = {
  name: 'repair',
  description: 'Bounded, budget-capped repair of a task blocked by a red test (T20) — dry-run by default, --confirm to actually spend.',
  options: [
    { name: 'confirm', description: 'Actually spend budget on repair (default: print the plan only)', type: 'boolean', default: false },
    { name: 'max-attempts', description: 'Outer bound on repair rounds (default 3)', type: 'number' },
    { name: 'budget', description: 'Total budget in USD across all rounds (default 5)', type: 'number' },
    { name: 'model', description: 'Model tier for the headless repair agent (default haiku)', type: 'string' },
    { name: 'command', description: "Override the test command (defaults to the project's own `npm test`)", type: 'string' },
    { name: 'timeout-ms', description: 'Per-round timeout in milliseconds', type: 'number' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] || (ctx.flags.id as string);
    if (!id) {
      output.printError('Usage: ruflo record task repair <id>');
      return { success: false, exitCode: 1 };
    }

    const dir = kindDir(ctx, 'task');
    const filePath = findRecordPath(dir, id);
    if (!filePath) {
      output.printError(`No task found matching id "${id}" in ${dir}`);
      return { success: false, exitCode: 1 };
    }

    const raw = readFileSync(filePath, 'utf8');
    const { frontmatter, body, parseError } = parseRecordFile(raw);
    if (parseError) {
      output.printError(`${filePath} is not valid YAML frontmatter`, parseError.message);
      return { success: false, exitCode: 1 };
    }
    const validated = validateRecord(frontmatter, body);
    if (!validated.success) {
      output.printError(`${filePath} does not currently validate`, formatValidationError(validated.error));
      return { success: false, exitCode: 1 };
    }
    const task = validated.record as Task;

    if (task.status !== 'blocked' || task.blocked?.fromState !== 'verifying') {
      output.printError(
        `Refusing to repair ${id}`,
        `status is "${task.status}"${task.blocked ? ` (blocked from "${task.blocked.fromState}")` : ''} — repair only applies to a task blocked by a red test from "verifying" (run \`ruflo record task verify ${id}\` first)`,
      );
      return { success: false, exitCode: 1 };
    }

    const maxAttempts = (ctx.flags.maxAttempts as number | undefined) ?? (ctx.flags['max-attempts'] as number | undefined);
    const budgetUsd = ctx.flags.budget as number | undefined;
    const model = ctx.flags.model as string | undefined;
    const timeoutMs = (ctx.flags.timeoutMs as number | undefined) ?? (ctx.flags['timeout-ms'] as number | undefined);
    const commandOverride = ctx.flags.command as string | undefined;
    const testCommand = resolveTestCommand(ctx.cwd, commandOverride);

    const repairResult = runRepairLoop({
      repo: ctx.cwd,
      testCommand,
      maxAttempts,
      budgetUsd,
      model,
      timeoutMs,
      confirm: ctx.flags.confirm === true,
    });

    if (repairResult.stopReason === 'dry-run') {
      output.printInfo(`Dry run — pass --confirm to actually spend on repair. Plan: ${JSON.stringify(repairResult.plan)}`);
      return { success: true, data: { id, dryRun: true, plan: repairResult.plan } };
    }

    output.printInfo(
      `repair: ${repairResult.attempts.length} round(s), $${repairResult.totalCostUsd.toFixed(4)} spent, stopped: ${repairResult.stopReason}`,
    );

    let transition: TransitionResult;
    let testRun: TestRunResult | undefined;
    if (repairResult.repaired) {
      const verify = await verifyTask(task, { cwd: ctx.cwd, command: commandOverride, timeoutMs });
      transition = verify.transition;
      testRun = verify.testRun;
    } else {
      transition = {
        ok: false,
        to: 'blocked',
        blocked: {
          reason: `repair exhausted (${repairResult.stopReason}) after ${repairResult.attempts.length} round(s): ${(repairResult.lastOutput ?? '').slice(0, 2000)}`,
          unblockCondition: 'fix the failing test manually, then re-run `ruflo record task verify`',
          fromState: 'verifying',
        },
      };
    }

    // T13: real spend from THIS repair, whether it ended repaired or
    // blocked — never left unset just because the task landed on blocked
    // rather than done (TASK-026's own acceptance criterion).
    const repairActuals = buildRepairActuals(repairResult);
    // Review #3, C1: the re-verify's own real receipt, persisted the same way task-verify.ts does.
    // Review #3, Important 5: see task-verify.ts — `verification` is hash-excluded, so its
    // receipt hash can come from the pre-verification patch and still match the finalized record.
    const patched = { ...applyTaskTransition(frontmatter, transition), ...(repairActuals ? { actuals: repairActuals } : {}) };
    const newFrontmatter = finalizeContentHash(
      { ...patched, ...(testRun ? { verification: buildVerificationReceipt(testRun, computeContentHash(patched, body)) } : {}) },
      body,
    );
    const validatedNew = validateRecord(newFrontmatter, body);
    if (!validatedNew.success) {
      output.printError('Refusing to write an invalid result', formatValidationError(validatedNew.error));
      return { success: false, exitCode: 1 };
    }
    writeFileSync(filePath, serializeRecordFile(newFrontmatter, body), 'utf8');

    if (transition.ok) {
      output.printSuccess(`${id} -> ${transition.to}`);
    } else {
      output.printWarning(`${id} -> blocked: ${transition.blocked.reason}`);
      output.writeln(`  unblock: ${transition.blocked.unblockCondition}`);
    }
    return { success: true, data: { id, status: newFrontmatter.status, transition, repairResult, testRun } };
  },
};

export default taskRepairCommand;
