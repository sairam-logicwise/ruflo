/**
 * `ruflo run` — T25, agentic SDLC plan (tasks/plan.md). The autonomy loop:
 * repeatedly scans every task record and advances whichever ones have a
 * real, evidenced next step, until a full pass makes no further progress.
 *
 * "Picks the next task whose preconditions are met" (the task's own
 * description) is `attemptTransition()` itself (T15) — calling it directly
 * for `drafted` and `specified` is safe because both preconditions are
 * real evidence checks (an `estimate`, a declared `doneCriteria`, and now
 * T16's citation-acceptance check on the drafted -> specified step), so a
 * task that hasn't earned its transition yet is correctly reported
 * `blocked`, never silently advanced.
 *
 * T16 (phase gate): `drafted -> specified`'s precondition now ALSO
 * requires every cited REQ/DEC to actually be `accepted` — computed here
 * via `checkCitationAcceptance()` (records-io.ts) and supplied as
 * `TransitionContext.citationAcceptance`, since state-machine.ts has no
 * filesystem access of its own (AD-1) and fails CLOSED when this evidence
 * is omitted. Deliberately scoped narrower than the plan's own literal
 * wording ("extend `authorizeMcpTool`"): there is no MCP-tool surface for
 * these record/task actions yet (`authorizeMcpTool` only gates tools
 * registered in `mcp-client.ts`'s registry, which record/task/run/
 * decompose never joined), and `AgenticPolicyEngine`'s own default mode
 * is a SITEWIDE chokepoint for the entire CLI/MCP surface — flipping it
 * would enforce every unrelated existing policy rule across the whole
 * platform, a blast radius wildly disproportionate to "gate this plan's
 * own workflow tools." This check lives directly in the one real
 * execution path these actions have today (the CLI command itself),
 * unconditionally — on by default, not behind an environment variable,
 * per the acceptance criterion — and applies identically no matter which
 * AI tool's shell access ran `ruflo run`.
 *
 * `implementing` is the one state this loop deliberately never touches:
 * its precondition is an intentional no-op — state-machine.ts's own words,
 * "an agent/human signals readiness to verify" — not a missing-evidence
 * gate. Calling attemptTransition() on it would trivially flip every task
 * mid-implementation straight to `verifying` with zero real work done.
 * There is no tool in this codebase yet that means "implementation is
 * actually finished"; until one exists, `implementing` always needs a
 * human.
 *
 * `verifying` runs T19's `verifyTask` (real test evidence). A task
 * `blocked` with `fromState: 'verifying'` optionally runs T20's bounded
 * repair (only with `--repair`, and only spends with `--confirm` too) —
 * capped at ONE repair attempt per task per `ruflo run` invocation, not
 * just per repair-loop call: retrying an already-failed repair on the next
 * pass would bypass T20's own per-invocation budget entirely, exactly the
 * runaway-spend scenario T20's design note warns about.
 *
 * T26's cross-task spend ceiling (`--spend-ceiling`, generous default) is
 * the second, independent backstop on top of that: it sums every repair's
 * `totalCostUsd` for the life of this one invocation and, once the running
 * total reaches the ceiling, refuses any FURTHER repair attempt for the
 * rest of the run — reported the same way any other stuck task is. It
 * only gates the repair phase, the only phase that spends anything today;
 * free transitions (drafted/specified/verifying) keep advancing
 * regardless, since a dollar ceiling has nothing to say about them. The
 * ceiling is a local variable, never persisted, so a resumed run after a
 * kill starts its count at zero — there is nothing to double-count,
 * because there is nowhere spend from a PRIOR invocation is stored.
 *
 * "All state lives in records, so the loop is restartable" (the task's own
 * rationale) needs no extra machinery here: every task file is read fresh
 * from disk at the top of each pass and written at most once per pass, so
 * killing this process mid-run and re-invoking `ruflo run` always resumes
 * from whatever the records actually say — there is no separate loop-state
 * file to fall out of sync with them.
 *
 * @module commands/run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { parseRecordFile, serializeRecordFile, validateRecord, attemptTransition, type Task, type TransitionResult } from '@claude-flow/docops';
import { kindDir, listRecordFiles, formatValidationError, applyTaskTransition, checkCitationAcceptance, buildRepairActuals, buildVerificationReceipt } from './records-io.js';
import { verifyTask, resolveTestCommand, type TestRunResult } from '../ruvector/test-runner.js';
import { runRepairLoop } from '../ruvector/repair-loop.js';

interface Outcome {
  id: string;
  action: 'advanced' | 'verified' | 'repaired';
  status: string;
  detail?: string;
}

interface Stuck {
  id: string;
  status: string;
  reason: string;
}

const DEFAULT_MAX_PASSES = 50;
/**
 * T26: "generous by default" — this is a backstop, not a policy, and
 * "should almost never fire" (the task's own rationale). $50 is 10x a
 * single task's own default $5 repair budget (repair-loop.ts), generous
 * enough to cover a real unattended run across many tasks without
 * interfering with normal work, while still being a real, finite ceiling
 * for the first overnight run nobody is watching.
 */
const DEFAULT_SPEND_CEILING_USD = 50;

const runCommand: Command = {
  name: 'run',
  description: 'The autonomy loop (T25) — advances every task with a real, evidenced next step; stops and reports the rest as needing a human.',
  options: [
    { name: 'repair', description: 'Also attempt bounded repair on tasks blocked by a red test (T20) — at most once per task per run', type: 'boolean', default: false },
    { name: 'confirm', description: 'Actually spend on repair (forwarded to repair-loop.ts; no effect without --repair)', type: 'boolean', default: false },
    { name: 'max-repair-attempts', description: 'Outer bound on repair rounds per task (default 3)', type: 'number' },
    { name: 'repair-budget', description: 'Total USD budget per task repair (default 5)', type: 'number' },
    { name: 'model', description: 'Model tier for repair (default haiku)', type: 'string' },
    { name: 'command', description: "Override the test command (defaults to the project's own `npm test`)", type: 'string' },
    { name: 'max-passes', description: `Safety cap on loop passes (default ${DEFAULT_MAX_PASSES})`, type: 'number' },
    { name: 'spend-ceiling', description: `Total USD spend ceiling across every repair this run (T26, default ${DEFAULT_SPEND_CEILING_USD}) — a backstop, checked before each repair attempt`, type: 'number' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dir = kindDir(ctx, 'task');
    const repairEnabled = ctx.flags.repair === true;
    const confirm = ctx.flags.confirm === true;
    const maxRepairAttempts = (ctx.flags.maxRepairAttempts as number | undefined) ?? (ctx.flags['max-repair-attempts'] as number | undefined);
    const repairBudget = (ctx.flags.repairBudget as number | undefined) ?? (ctx.flags['repair-budget'] as number | undefined);
    const model = ctx.flags.model as string | undefined;
    const commandOverride = ctx.flags.command as string | undefined;
    const maxPasses = (ctx.flags.maxPasses as number | undefined) ?? (ctx.flags['max-passes'] as number | undefined) ?? DEFAULT_MAX_PASSES;
    const spendCeiling = (ctx.flags.spendCeiling as number | undefined) ?? (ctx.flags['spend-ceiling'] as number | undefined) ?? DEFAULT_SPEND_CEILING_USD;

    const repairAttemptedThisRun = new Set<string>();
    let spentUsd = 0; // T26: local to this invocation only — never persisted, so a resumed run starts at $0, nothing to double-count
    const outcomes: Outcome[] = [];
    let stuck: Stuck[] = [];
    let pass = 0;
    let madeProgress = true;

    while (madeProgress && pass < maxPasses) {
      pass++;
      madeProgress = false;
      stuck = [];

      for (const file of listRecordFiles(dir)) {
        const filePath = join(dir, file);
        const raw = readFileSync(filePath, 'utf8');
        const { frontmatter, body, parseError } = parseRecordFile(raw);
        if (parseError) {
          stuck.push({ id: file, status: 'unknown', reason: `invalid frontmatter: ${parseError.message}` });
          continue;
        }
        const validated = validateRecord(frontmatter, body);
        if (!validated.success) {
          stuck.push({ id: String(frontmatter.id ?? file), status: 'unknown', reason: `does not validate: ${formatValidationError(validated.error)}` });
          continue;
        }
        const task = validated.record as Task;

        if (task.status === 'done') continue;

        // T13/C1: `actuals`/`verification` are optional patches on top of
        // the transition — only the verifying and repair branches below
        // ever have either to report.
        const write = (transition: TransitionResult, extra: { actuals?: ReturnType<typeof buildRepairActuals>; verification?: ReturnType<typeof buildVerificationReceipt> } = {}): string | undefined => {
          const newFrontmatter = {
            ...applyTaskTransition(frontmatter, transition),
            ...(extra.actuals ? { actuals: extra.actuals } : {}),
            ...(extra.verification ? { verification: extra.verification } : {}),
          };
          const validatedNew = validateRecord(newFrontmatter, body);
          if (!validatedNew.success) return `refusing to write invalid result: ${formatValidationError(validatedNew.error)}`;
          writeFileSync(filePath, serializeRecordFile(newFrontmatter, body), 'utf8');
          return undefined;
        };

        if (task.status === 'drafted' || task.status === 'specified') {
          const transition = attemptTransition(task, task.status, { citationAcceptance: checkCitationAcceptance(ctx, task) });
          const err = write(transition);
          if (err) { stuck.push({ id: task.id, status: task.status, reason: err }); continue; }
          madeProgress = true;
          outcomes.push(transition.ok
            ? { id: task.id, action: 'advanced', status: transition.to }
            : { id: task.id, action: 'advanced', status: 'blocked', detail: transition.blocked.reason });
          continue;
        }

        // Resume a task blocked from drafted/specified (never from verifying —
        // that's the repair branch below) once whatever a human fixed makes
        // the SAME attemptTransition() call succeed. Found via T16's own
        // manual verification: state-machine.ts's AD-4 promises "blocked is
        // never terminal", but nothing in this CLI ever called
        // resumeFromBlocked() before this — a task blocked on a missing
        // estimate, or now an unaccepted citation, had no path back at all,
        // for any reason, not just T16's new one. Re-attempts every pass,
        // but only counts as progress (and only writes) when the verdict
        // actually changes — either it succeeds, or the blocked REASON
        // itself changes (real, if partial, progress: e.g. citation fixed,
        // now blocked on the estimate instead). An unchanged reason is the
        // same "repeated failure" signal T20's repair loop already uses to
        // stop, so a genuinely stuck task is reported once and never
        // rewritten again this run, not churned every pass until maxPasses.
        if (task.status === 'blocked' && task.blocked && task.blocked.fromState !== 'verifying') {
          const fromState = task.blocked.fromState;
          const previousReason = task.blocked.reason;
          const transition = attemptTransition(task, fromState, { citationAcceptance: checkCitationAcceptance(ctx, task) });
          if (!transition.ok && transition.blocked.reason === previousReason) {
            stuck.push({ id: task.id, status: task.status, reason: `${transition.blocked.reason} — needs a human` });
            continue;
          }
          const err = write(transition);
          if (err) { stuck.push({ id: task.id, status: task.status, reason: err }); continue; }
          madeProgress = true;
          outcomes.push(transition.ok
            ? { id: task.id, action: 'advanced', status: transition.to }
            : { id: task.id, action: 'advanced', status: 'blocked', detail: transition.blocked.reason });
          continue;
        }

        if (task.status === 'verifying') {
          const { transition, testRun } = await verifyTask(task, { cwd: ctx.cwd, command: commandOverride });
          const err = write(transition, { verification: testRun ? buildVerificationReceipt(testRun, frontmatter.contentHash as string) : undefined });
          if (err) { stuck.push({ id: task.id, status: task.status, reason: err }); continue; }
          madeProgress = true;
          outcomes.push({ id: task.id, action: 'verified', status: transition.ok ? transition.to : 'blocked', detail: testRun ? `exit ${testRun.exitCode}` : undefined });
          continue;
        }

        if (task.status === 'blocked' && task.blocked?.fromState === 'verifying') {
          if (!repairEnabled) {
            stuck.push({ id: task.id, status: task.status, reason: `${task.blocked.reason} — pass --repair to attempt automated repair` });
            continue;
          }
          if (repairAttemptedThisRun.has(task.id)) {
            stuck.push({ id: task.id, status: task.status, reason: 'repair already attempted this run — re-run `ruflo run --repair` to try again' });
            continue;
          }
          if (spentUsd >= spendCeiling) {
            stuck.push({ id: task.id, status: task.status, reason: `spend ceiling reached ($${spentUsd.toFixed(2)} / $${spendCeiling.toFixed(2)} this run) — raise --spend-ceiling or re-run later` });
            continue;
          }
          repairAttemptedThisRun.add(task.id);

          const testCommand = resolveTestCommand(ctx.cwd, commandOverride);
          const repairResult = runRepairLoop({ repo: ctx.cwd, testCommand, maxAttempts: maxRepairAttempts, budgetUsd: repairBudget, model, confirm });
          spentUsd += repairResult.totalCostUsd; // T26: counted the instant it's spent, even if this task ends up stuck below
          if (repairResult.stopReason === 'dry-run') {
            stuck.push({ id: task.id, status: task.status, reason: 'repair dry run only — pass --confirm to actually spend' });
            continue;
          }

          let transition: TransitionResult;
          let reVerifyTestRun: TestRunResult | undefined;
          if (repairResult.repaired) {
            const reVerify = await verifyTask(task, { cwd: ctx.cwd, command: commandOverride });
            transition = reVerify.transition;
            reVerifyTestRun = reVerify.testRun;
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
          // T13/C1: written whether this ended repaired or exhausted-and-blocked.
          const err = write(transition, {
            actuals: buildRepairActuals(repairResult),
            verification: reVerifyTestRun ? buildVerificationReceipt(reVerifyTestRun, frontmatter.contentHash as string) : undefined,
          });
          if (err) { stuck.push({ id: task.id, status: task.status, reason: err }); continue; }
          madeProgress = true;
          outcomes.push({ id: task.id, action: 'repaired', status: transition.ok ? transition.to : 'blocked', detail: `$${repairResult.totalCostUsd.toFixed(4)}, ${repairResult.stopReason}` });
          continue;
        }

        const reason = task.status === 'blocked'
          ? `${task.blocked?.reason ?? 'blocked'} — needs a human`
          : task.status === 'implementing'
            ? 'implementing has no automated phase-runner — needs a human or agent to run `ruflo record task ready` once implementation is actually finished'
            : `"${task.status}" has no automated phase-runner yet — needs a human`;
        stuck.push({ id: task.id, status: task.status, reason });
      }
    }

    for (const o of outcomes) output.printInfo(`${o.id}: ${o.action} -> ${o.status}${o.detail ? ` (${o.detail})` : ''}`);
    if (repairEnabled) output.printInfo(`spend this run: $${spentUsd.toFixed(4)} / $${spendCeiling.toFixed(2)} ceiling`);
    if (stuck.length > 0) {
      output.printWarning(`stopped after ${pass} pass(es) — ${stuck.length} task(s) need a human:`);
      for (const s of stuck) output.writeln(`  ${s.id} (${s.status}): ${s.reason}`);
    } else if (outcomes.length === 0) {
      output.printInfo('no task records found, or every task is already done — nothing to do');
    } else {
      output.printSuccess(`stopped after ${pass} pass(es) — no tasks remaining`);
    }

    return { success: true, data: { passes: pass, outcomes, stuck, spentUsd, spendCeilingUsd: spendCeiling } };
  },
};

export default runCommand;
