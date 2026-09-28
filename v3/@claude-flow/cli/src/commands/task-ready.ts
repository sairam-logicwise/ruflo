/**
 * `ruflo record task ready <id>` — Review #3, Important 6 (agentic SDLC
 * plan, tasks/plan.md).
 *
 * Advances `implementing -> verifying`. state-machine.ts's own words:
 * "no structural gate beyond having left implementing — an agent/human
 * signals readiness to verify." That precondition is an intentional
 * no-op, not a missing-evidence gate — there is no code path in this
 * repo that can mechanically prove "the implementation is actually
 * finished," so this step stays a deliberate, named human/agent
 * declaration, not something `ruflo run` auto-advances (run.ts's own
 * module doc says so explicitly, and still does after this task).
 *
 * The review found this command simply didn't exist: nothing anywhere
 * in this codebase could move a task out of `implementing` except
 * hand-editing the record file directly — "the exact hole T18/T19 exist
 * to close," reached anyway because this one step had no command of its
 * own. This closes it — a real, auditable, gated action (still checks
 * the task is actually `implementing` first) instead of an unaudited
 * file edit.
 *
 * @module commands/task-ready
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { parseRecordFile, serializeRecordFile, validateRecord, attemptTransition, type Task } from '@claude-flow/docops';
import { kindDir, findRecordPath, formatValidationError, applyTaskTransition, finalizeContentHash } from './records-io.js';

const taskReadyCommand: Command = {
  name: 'ready',
  description: 'Declare a task ready for verification (implementing -> verifying) — the one deliberate human/agent judgement call this lifecycle has, not an evidence gate.',
  options: [{ name: 'id', description: 'Task id', type: 'string' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] || (ctx.flags.id as string);
    if (!id) {
      output.printError('Usage: ruflo record task ready <id>');
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

    if (task.status !== 'implementing') {
      output.printError(
        `Refusing to mark ${id} ready`,
        `status is "${task.status}", not "implementing" — advance it through the lifecycle first (drafted -> specified -> implementing)`,
      );
      return { success: false, exitCode: 1 };
    }

    const transition = attemptTransition(task, 'implementing', {});
    const newFrontmatter = finalizeContentHash(applyTaskTransition(frontmatter, transition), body);
    const validatedNew = validateRecord(newFrontmatter, body);
    if (!validatedNew.success) {
      output.printError('Refusing to write an invalid result', formatValidationError(validatedNew.error));
      return { success: false, exitCode: 1 };
    }
    writeFileSync(filePath, serializeRecordFile(newFrontmatter, body), 'utf8');

    output.printSuccess(`${id} -> ${newFrontmatter.status}`);
    return { success: true, data: { id, status: newFrontmatter.status, transition } };
  },
};

export default taskReadyCommand;
