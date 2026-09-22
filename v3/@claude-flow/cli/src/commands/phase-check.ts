/**
 * `ruflo record phase-check` — T17, agentic SDLC plan (tasks/plan.md).
 * "The phase-gate check" the plan's own description names as one of the
 * two things the CI job must run (record validation is the other,
 * already `ruflo record validate`).
 *
 * `record validate` checks schema/citation-contract/readability/content-
 * hash — a task record with `status: implementing` and no `doneCriteria`
 * at all currently PASSES it, since those fields are `.optional()` in the
 * schema (T18/T19 formalize them per task, not as a blanket requirement).
 * This command is the missing piece: a READ-ONLY, static audit that a
 * task's CURRENT recorded status is still actually earned by its current
 * fields — never a live re-check (it doesn't run tests; that's tier 1's
 * job) and never a write (unlike `task verify`/`task repair`/`run`, this
 * command never transitions anything).
 *
 * Reuses state-machine.ts's own `attemptTransition()` as a pure QUERY
 * rather than duplicating its PRECONDITIONS — for a task at status X, every
 * resumable state strictly before X in the forward chain is replayed with
 * FRESH evidence (`checkCitationAcceptance()`, same as T16's `run.ts`
 * wiring), so a requirement that was accepted when a task reached
 * `specified` but got superseded afterward is caught here, not just at
 * the moment of transition. `verifying -> done`'s test-evidence gate is
 * deliberately excluded — replaying it would mean re-running the whole
 * test suite inside a "check the records" command, redundant with the
 * project's own CI test job.
 *
 * @module commands/phase-check
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { parseRecordFile, validateRecord, attemptTransition, type Task, type ResumableState } from '@claude-flow/docops';
import { kindDir, listRecordFiles, formatValidationError, checkCitationAcceptance } from './records-io.js';

/** States strictly before `status` in the forward chain, worth re-checking with fresh evidence. Excludes the live test-evidence gate (verifying -> done) — see module doc. */
function statesToAudit(status: Task['status']): ResumableState[] {
  switch (status) {
    case 'specified': return ['drafted'];
    case 'implementing': return ['drafted', 'specified'];
    case 'verifying': return ['drafted', 'specified', 'implementing'];
    case 'done': return ['drafted', 'specified', 'implementing'];
    default: return []; // drafted: nothing prior to audit; blocked: already carries its own diagnosis
  }
}

const phaseCheckCommand: Command = {
  name: 'phase-check',
  description: "Audit every task record for state-machine consistency (T17) — flags a task whose current status is no longer earned by its current fields, without transitioning anything.",
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dir = kindDir(ctx, 'task');
    const problems: { id: string; reason: string }[] = [];

    for (const file of listRecordFiles(dir)) {
      const filePath = join(dir, file);
      const { frontmatter, body, parseError } = parseRecordFile(readFileSync(filePath, 'utf8'));
      if (parseError) { problems.push({ id: file, reason: `invalid frontmatter: ${parseError.message}` }); continue; }
      const validated = validateRecord(frontmatter, body);
      if (!validated.success) { problems.push({ id: String(frontmatter.id ?? file), reason: `does not validate: ${formatValidationError(validated.error)}` }); continue; }
      const task = validated.record as Task;

      for (const priorState of statesToAudit(task.status)) {
        const transition = attemptTransition(task, priorState, { citationAcceptance: checkCitationAcceptance(ctx, task) });
        if (!transition.ok) {
          problems.push({ id: task.id, reason: `status is "${task.status}" but no longer satisfies the "${priorState}" precondition: ${transition.blocked.reason}` });
        }
      }
    }

    if (problems.length > 0) {
      output.printError(`${problems.length} task record(s) failed the phase-gate consistency check`);
      for (const p of problems) output.writeln(`  ${p.id}: ${p.reason}`);
      return { success: false, exitCode: 1, data: { problems } };
    }

    output.printSuccess(`All task record(s) are phase-gate consistent.`);
    return { success: true, data: { problems: [] } };
  },
};

export default phaseCheckCommand;
