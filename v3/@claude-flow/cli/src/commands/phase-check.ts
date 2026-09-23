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
 * the moment of transition.
 *
 * Review #3, C1: `verifying -> done` used to be excluded entirely on the
 * reasoning that auditing it would mean re-running the whole test suite
 * inside a "check the records" command. That reasoning missed a real gap
 * — a hand-written `status: done` with a fabricated `doneCriteria` and no
 * test evidence at all passed this command cleanly, because nothing here
 * ever looked at whether `done` had actually been earned. The fix isn't
 * to re-run tests (still true, still out of scope, still the project's
 * own CI test job) — it's to check the RECEIPT `task-verify.ts`/
 * `task-repair.ts`/`run.ts` now persist on every real test run
 * (`buildVerificationReceipt`, records-io.ts). A `done` task with any
 * required test layer must carry a `verification` receipt whose own
 * `contentHash` matches the record's CURRENT `contentHash` — a missing
 * receipt (never verified) or a stale one (verified against a body that
 * has since changed) both fail this the same way a missing test result
 * always has elsewhere in this plan.
 *
 * @module commands/phase-check
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { parseRecordFile, validateRecord, attemptTransition, type Task, type ResumableState } from '@claude-flow/docops';
import { kindDir, listRecordFiles, formatValidationError, checkCitationAcceptance } from './records-io.js';

/** States strictly before `status` in the forward chain, worth re-checking with fresh evidence. `verifying -> done` is audited separately, against the persisted receipt — see module doc. */
function statesToAudit(status: Task['status']): ResumableState[] {
  switch (status) {
    case 'specified': return ['drafted'];
    case 'implementing': return ['drafted', 'specified'];
    case 'verifying': return ['drafted', 'specified', 'implementing'];
    case 'done': return ['drafted', 'specified', 'implementing'];
    default: return []; // drafted: nothing prior to audit; blocked: already carries its own diagnosis
  }
}

/**
 * Review #3, C1: a `done` task whose declared `doneCriteria.testLayers`
 * is non-empty must carry a real, CURRENT verification receipt. An empty
 * `testLayers` is T18's own "a task declared it needs no tests" case —
 * nothing to audit, by the state machine's own `done` precondition
 * (state-machine.ts), not a gap in this check.
 */
function auditDoneReceipt(task: Task): string | undefined {
  if (task.status !== 'done') return undefined;
  const requiredLayers = task.doneCriteria?.testLayers ?? [];
  if (requiredLayers.length === 0) return undefined;
  if (!task.verification) {
    return `status is "done" with required test layers (${requiredLayers.join(', ')}) but carries no verification receipt at all`;
  }
  if (task.verification.contentHash !== task.contentHash) {
    return `status is "done" but its verification receipt was produced against a different body (receipt contentHash ${task.verification.contentHash.slice(0, 12)}… vs current ${task.contentHash.slice(0, 12)}…) — re-verify after the edit`;
  }
  return undefined;
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

      const receiptProblem = auditDoneReceipt(task);
      if (receiptProblem) problems.push({ id: task.id, reason: receiptProblem });
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
