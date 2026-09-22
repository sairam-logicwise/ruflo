/**
 * test-runner.ts — the engine behind T19 (agentic SDLC plan, tasks/plan.md).
 * Runs the project's own test command, derives pass/fail strictly from its
 * exit code (never from parsing output text, which an agent — or a flaky
 * test framework — could make say anything), and feeds that evidence into
 * T15's `attemptTransition` for the `verifying -> done` step. Reuses
 * `coverageGaps()`/`getOverallCoverage()` from `coverage-router.ts` for the
 * coverage side, per plan.md's own citation.
 *
 * "The agent has no API to set Done directly" (T19's acceptance criterion)
 * is a property of the CALLER, not this module: `verifyTask` never accepts
 * a raw status override, only real evidence it goes on to derive a verdict
 * from — there is no code path here that just writes `done`.
 *
 * @module ruvector/test-runner
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { attemptTransition, type Task, type TransitionResult } from '@claude-flow/docops';
import { coverageGaps, getOverallCoverage } from './coverage-router.js';

export interface TestRunResult {
  /** Derived strictly from the test command's exit code — 0 = passed, anything else = failed. */
  passed: boolean;
  exitCode: number;
  command: string;
  /** Combined stdout+stderr, tail-truncated — the failure, not the setup noise. */
  output: string;
  durationMs: number;
  /** Overall project coverage — set only when a threshold was requested and a coverage report exists. */
  coverage?: number;
  /** Files below the requested threshold, from coverageGaps() — omitted when nothing is below it. */
  coverageGapFiles?: string[];
}

export interface RunTestsOptions {
  /** Overrides the project's own package.json test script. */
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  /** When set, also loads and reports coverage against this threshold. */
  coverageThreshold?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // a real test suite can genuinely take a while
const OUTPUT_TAIL_CHARS = 20_000;

function resolveTestCommand(cwd: string, override?: string): string {
  if (override) return override;
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test) return 'npm test';
    } catch {
      // Malformed package.json — fall through to the same default below.
    }
  }
  return 'npm test';
}

/**
 * Runs the project's own test command. `shell: true` executes whatever
 * `npm test` (or an explicit override) resolves to, same as a human typing
 * it — this is not attacker-controlled input, it's the project's own
 * package.json, the same trust boundary `npm test` itself already crosses.
 */
export async function runTests(opts: RunTestsOptions = {}): Promise<TestRunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const command = resolveTestCommand(cwd, opts.command);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const start = performance.now();
  const result = spawnSync(command, { cwd, shell: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const durationMs = performance.now() - start;

  // A timeout or signal kill leaves `status` null — treat that as a real
  // failure (124, the conventional shell timeout code), not an "unknown"
  // that some caller might treat as neither pass nor fail.
  const exitCode = result.status ?? (result.signal ? 124 : 1);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-OUTPUT_TAIL_CHARS);

  const testRun: TestRunResult = { passed: exitCode === 0, exitCode, command, output, durationMs };

  if (opts.coverageThreshold != null) {
    const [overall, gaps] = await Promise.all([
      getOverallCoverage(cwd),
      coverageGaps({ projectRoot: cwd, threshold: opts.coverageThreshold }),
    ]);
    if (overall != null) testRun.coverage = overall;
    if (gaps.totalGaps > 0) testRun.coverageGapFiles = gaps.gaps.map((g) => g.file);
  }

  return testRun;
}

/**
 * Runs the evidenced `verifying -> done` step for `task`: if it declares
 * no required test layers, defers straight to `attemptTransition` (which
 * already exempts that case — T15's own design); otherwise actually runs
 * the tests (and coverage, if a threshold is declared) and hands the real
 * result to `attemptTransition` as `TransitionContext.testResult`. The
 * caller is responsible for writing the resulting state back to the task
 * record — this function only decides what it should be, same contract
 * `attemptTransition` itself keeps.
 */
export async function verifyTask(
  task: Task,
  opts: RunTestsOptions = {},
): Promise<{ transition: TransitionResult; testRun?: TestRunResult }> {
  const requiredLayers = task.doneCriteria?.testLayers ?? [];
  if (requiredLayers.length === 0) {
    return { transition: attemptTransition(task, 'verifying', {}) };
  }

  const testRun = await runTests({ ...opts, coverageThreshold: task.doneCriteria?.coverageThreshold });
  return {
    transition: attemptTransition(task, 'verifying', {
      testResult: { passed: testRun.passed, coverage: testRun.coverage },
    }),
    testRun,
  };
}
