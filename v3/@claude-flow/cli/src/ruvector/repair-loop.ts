/**
 * repair-loop.ts — T20, agentic SDLC plan (tasks/plan.md). Wraps the
 * existing `plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs`
 * (headless `claude -p` test-driven repair) with the bound this plan calls
 * for: "without a limit, a task that cannot be fixed will consume budget
 * indefinitely with nobody watching."
 *
 * tdd-repair.mjs already loops internally (`--max-attempts`), but that loop
 * is opaque to us — we can't inspect it between rounds. So this wrapper
 * pins each spawn to exactly one internal attempt (`--max-attempts 1`) and
 * owns the outer loop itself, which is what makes the repeated-failure
 * short-circuit possible: comparing round i's result to round i-1's before
 * paying for round i+1.
 *
 * Two independent stopping conditions, either one ends the loop before
 * `maxAttempts` is reached:
 *   - the same failure twice in a row (hash of the post-attempt test
 *     result equals the previous round's) — retrying a fix that already
 *     didn't work is a waste, not a second chance
 *   - the cumulative cost has reached the budget
 *
 * `confirm: false` (the default) never spawns anything — same dry-run
 * contract tdd-repair.mjs itself uses, so a caller can inspect the plan
 * (attempts, budget, model) at zero cost before opting in.
 *
 * @module ruvector/repair-loop
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RepairLoopOptions {
  repo: string;
  testCommand: string;
  /** Descriptive label for the failing scope — tdd-repair.mjs requires *some* value for its prompt, but T19's runner verifies a whole suite, not one file. */
  test?: string;
  /** Outer bound on OUR loop — distinct from tdd-repair.mjs's own `--max-attempts`, which is always pinned to 1 so this wrapper controls retries. */
  maxAttempts?: number;
  /** Total budget across every attempt, divided evenly per round. */
  budgetUsd?: number;
  model?: string;
  timeoutMs?: number;
  /** Explicit opt-in to actually spend — required, mirrors tdd-repair.mjs's own `--confirm` gate (defense in depth). */
  confirm: boolean;
}

export interface RepairAttemptResult {
  attempt: number;
  repaired: boolean;
  exitCode: number | null;
  costUsd: number;
  outputHash: string | null;
  /**
   * T13: real input/output tokens for this round, read from tdd-repair.mjs's
   * own `attempts[0].claude.usage` (the raw `claude -p --output-format json`
   * usage block — tdd-repair.mjs's own comment: "emits {result, usage,
   * ...}"). Optional, not defaulted to 0: a round that never produced usage
   * (tdd-repair-unavailable, a config error) has genuinely no token data,
   * and 0 would misrepresent that as "measured, cost nothing" instead of
   * "never measured" — the same "don't fabricate a missing number"
   * reasoning corpus.ts's own Important-7 exclusion already applies to a
   * trajectory row with no usable tokens.
   */
  inputTokens?: number;
  outputTokens?: number;
}

export type RepairStopReason =
  | 'dry-run'
  | 'repaired'
  | 'max-attempts-exhausted'
  | 'budget-exhausted'
  | 'repeated-failure'
  | 'tdd-repair-unavailable'
  | 'tdd-repair-config-error';

export interface RepairLoopResult {
  repaired: boolean;
  stopReason: RepairStopReason;
  attempts: RepairAttemptResult[];
  totalCostUsd: number;
  /** T13: sum of every real attempt's inputTokens/outputTokens. Undefined (not 0) when no attempt carried real usage — see RepairAttemptResult's own doc. */
  totalInputTokens?: number;
  totalOutputTokens?: number;
  /** The last attempt's test/failure output — attached so an exhausted repair leaves a diagnosable trail, not a dead end. */
  lastOutput?: string;
  plan?: { repo: string; testCommand: string; maxAttempts: number; budgetUsd: number; model: string };
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BUDGET_USD = 5;
const DEFAULT_MODEL = 'haiku';

/** Walks up from this file looking for the script — robust to running from `dist/` vs `src/` and to this package's depth in the monorepo. */
function resolveTddRepairScript(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs walking up from repair-loop.ts — has the repo layout changed?',
  );
}

function hashOutput(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function runRepairLoop(opts: RepairLoopOptions): RepairLoopResult {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const budgetUsd = opts.budgetUsd ?? DEFAULT_BUDGET_USD;
  const model = opts.model ?? DEFAULT_MODEL;
  const plan = { repo: opts.repo, testCommand: opts.testCommand, maxAttempts, budgetUsd, model };

  if (!opts.confirm) {
    return { repaired: false, stopReason: 'dry-run', attempts: [], totalCostUsd: 0, plan };
  }

  const scriptPath = resolveTddRepairScript();
  const perAttemptBudget = budgetUsd / maxAttempts;

  const attempts: RepairAttemptResult[] = [];
  let previousHash: string | null = null;
  let totalCostUsd = 0;
  let totalInputTokens: number | undefined;
  let totalOutputTokens: number | undefined;
  let lastOutput: string | undefined;

  for (let i = 1; i <= maxAttempts; i++) {
    const args = [
      scriptPath,
      '--repo', opts.repo,
      '--test', opts.test ?? '(project test suite — see --test-command)',
      '--test-command', opts.testCommand,
      '--max-attempts', '1',
      '--budget', String(perAttemptBudget),
      '--model', model,
      '--confirm',
      '--format', 'json',
      ...(opts.timeoutMs ? ['--timeout-ms', String(opts.timeoutMs)] : []),
    ];
    const result = spawnSync(process.execPath, args, { cwd: opts.repo, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });

    let parsed: { success?: boolean; data?: Record<string, unknown> } | null = null;
    try {
      parsed = JSON.parse(result.stdout ?? '');
    } catch {
      // leave null — tdd-repair.mjs failed to even produce JSON
    }

    if (!parsed) {
      attempts.push({ attempt: i, repaired: false, exitCode: result.status, costUsd: 0, outputHash: null });
      return { repaired: false, stopReason: 'tdd-repair-unavailable', attempts, totalCostUsd, lastOutput: (result.stderr ?? '').slice(-2000), plan };
    }
    if (parsed.data?.reason === 'claude-cli-not-installed') {
      attempts.push({ attempt: i, repaired: false, exitCode: result.status, costUsd: 0, outputHash: null });
      return { repaired: false, stopReason: 'tdd-repair-unavailable', attempts, totalCostUsd, plan };
    }
    if (result.status === 2) {
      // config error (bad --test-command, etc) — not a failed repair attempt, don't burn a retry on it
      attempts.push({ attempt: i, repaired: false, exitCode: result.status, costUsd: 0, outputHash: null });
      return { repaired: false, stopReason: 'tdd-repair-config-error', attempts, totalCostUsd, lastOutput: JSON.stringify(parsed.data), plan };
    }

    const costUsd = (parsed.data?.totalCostUsd as number | undefined) ?? 0;
    totalCostUsd += costUsd;
    // --max-attempts 1 pins tdd-repair.mjs to exactly one internal round per
    // spawn, so its own attempts[0] is THIS round's real usage.
    const roundAttempts = parsed.data?.attempts as Array<{ claude?: { usage?: { input_tokens?: number; output_tokens?: number } } }> | undefined;
    const usage = roundAttempts?.[0]?.claude?.usage;
    const inputTokens = usage?.input_tokens;
    const outputTokens = usage?.output_tokens;
    if (inputTokens !== undefined || outputTokens !== undefined) {
      totalInputTokens = (totalInputTokens ?? 0) + (inputTokens ?? 0);
      totalOutputTokens = (totalOutputTokens ?? 0) + (outputTokens ?? 0);
    }
    const outputText = JSON.stringify(parsed.data?.after ?? parsed.data?.attempts ?? '');
    const outputHash = hashOutput(outputText);
    lastOutput = outputText;

    attempts.push({ attempt: i, repaired: !!parsed.success, exitCode: result.status, costUsd, outputHash, inputTokens, outputTokens });

    if (parsed.success) {
      return { repaired: true, stopReason: 'repaired', attempts, totalCostUsd, totalInputTokens, totalOutputTokens, lastOutput, plan };
    }
    if (previousHash !== null && outputHash === previousHash) {
      return { repaired: false, stopReason: 'repeated-failure', attempts, totalCostUsd, totalInputTokens, totalOutputTokens, lastOutput, plan };
    }
    previousHash = outputHash;

    if (totalCostUsd >= budgetUsd) {
      return { repaired: false, stopReason: 'budget-exhausted', attempts, totalCostUsd, totalInputTokens, totalOutputTokens, lastOutput, plan };
    }
  }

  return { repaired: false, stopReason: 'max-attempts-exhausted', attempts, totalCostUsd, totalInputTokens, totalOutputTokens, lastOutput, plan };
}
