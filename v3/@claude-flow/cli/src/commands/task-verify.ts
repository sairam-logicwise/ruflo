/**
 * `ruflo record task verify <id>` — T19, agentic SDLC plan (tasks/plan.md).
 *
 * Runs the required test layers for a task (state-machine.ts's `verifying
 * -> done` precondition) and writes the DERIVED result back to the
 * record — never a status a caller merely asserts. This is the only
 * status-mutating command this CLI exposes for an EXISTING task (creation
 * always starts at `drafted`); there is no `--status done` override
 * anywhere in it, by construction, not by convention — the acceptance
 * criterion "the agent has no API to set Done directly".
 *
 * Named `task-verify.ts`, not `verify.ts` — this repo already has an
 * unrelated top-level `ruflo verify` (signed witness manifest
 * verification) at that path. A real mistake, caught only by `git status`
 * showing an unexpected `M` on a file this session never intended to
 * touch: an earlier draft of this command was written straight to
 * `verify.ts`, silently overwriting 282 lines of real, working,
 * completely unrelated functionality. Restored from `git show HEAD:...`
 * before it could reach a commit; this file is the real fix.
 *
 * @module commands/task-verify
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { parseRecordFile, serializeRecordFile, validateRecord, type Task } from '@claude-flow/docops';
import { kindDir, findRecordPath, formatValidationError, applyTaskTransition, buildVerificationReceipt } from './records-io.js';
import { verifyTask } from '../ruvector/test-runner.js';

const taskVerifyCommand: Command = {
  name: 'verify',
  description: "Run the required tests for a task and derive its status from the real result (T19) — done is unreachable without a green test result.",
  options: [
    { name: 'command', description: "Override the test command (defaults to the project's own `npm test`)", type: 'string' },
    { name: 'timeout-ms', description: 'Test command timeout in milliseconds', type: 'number' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] || (ctx.flags.id as string);
    if (!id) {
      output.printError('Usage: ruflo record task verify <id>');
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

    if (task.status !== 'verifying') {
      output.printError(
        `Refusing to verify ${id}`,
        `status is "${task.status}", not "verifying" — advance it through the lifecycle first (drafted -> specified -> implementing -> verifying)`,
      );
      return { success: false, exitCode: 1 };
    }

    const timeoutMs = (ctx.flags.timeoutMs as number | undefined) ?? (ctx.flags['timeout-ms'] as number | undefined);
    const { transition, testRun } = await verifyTask(task, {
      cwd: ctx.cwd,
      command: ctx.flags.command as string | undefined,
      timeoutMs,
    });

    if (testRun) {
      const coverageNote = testRun.coverage != null ? `, coverage ${testRun.coverage.toFixed(1)}%` : '';
      output.printInfo(`${testRun.command} — exit ${testRun.exitCode}, ${(testRun.durationMs / 1000).toFixed(1)}s${coverageNote}`);
    }

    // Review #3, C1: persist the real receipt a test run produced — never
    // discarded, so phase-check can audit verifying -> done against it.
    const newFrontmatter: Record<string, unknown> = {
      ...applyTaskTransition(frontmatter, transition),
      ...(testRun ? { verification: buildVerificationReceipt(testRun, frontmatter.contentHash as string) } : {}),
    };

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
    return { success: true, data: { id, status: newFrontmatter.status, transition, testRun } };
  },
};

export default taskVerifyCommand;
