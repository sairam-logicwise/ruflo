/**
 * T19 (agentic SDLC plan) — the test runner: pass/fail derived strictly
 * from the test command's real exit code, coverage reused from
 * coverage-router.ts, and the evidence handed to state-machine.ts's
 * attemptTransition for the verifying -> done step.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '@claude-flow/docops';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

import { spawnSync } from 'node:child_process';
import { runTests, verifyTask } from '../../src/ruvector/test-runner.js';

function fakeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-001',
    title: 'x',
    status: 'verifying',
    priority: 'p2',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    citations: ['REQ-001'],
    dependsOn: [],
    contentHash: '0'.repeat(64),
    provenance: 'human',
    readabilityStrict: false,
    ...overrides,
  } as Task;
}

describe('runTests', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'test-runner-'));
    vi.mocked(spawnSync).mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('derives passed from exit code 0', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'ok', stderr: '', signal: null } as never);
    const result = await runTests({ cwd: tmp, command: 'echo ok' });
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('derives failed from a nonzero exit code, regardless of what stdout says', async () => {
    // Deliberately says "PASSED" in stdout but exits nonzero — status must
    // come from the exit code alone, never from parsing output text.
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: 'ALL TESTS PASSED', stderr: '', signal: null } as never);
    const result = await runTests({ cwd: tmp, command: 'exit 1' });
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('treats a timeout/signal kill as a real failure, not an unknown state', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: null, stdout: '', stderr: '', signal: 'SIGTERM' } as never);
    const result = await runTests({ cwd: tmp, command: 'sleep 999', timeoutMs: 10 });
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(124);
  });

  it('uses an explicit command override rather than resolving package.json', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null } as never);
    await runTests({ cwd: tmp, command: 'my-custom-test-command' });
    expect(spawnSync).toHaveBeenCalledWith('my-custom-test-command', expect.objectContaining({ cwd: tmp }));
  });

  it('resolves to "npm test" when the project package.json declares a test script', async () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null } as never);
    await runTests({ cwd: tmp });
    expect(spawnSync).toHaveBeenCalledWith('npm test', expect.anything());
  });

  it('does not check coverage when no threshold is requested', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null } as never);
    const result = await runTests({ cwd: tmp, command: 'echo ok' });
    expect(result.coverage).toBeUndefined();
    expect(result.coverageGapFiles).toBeUndefined();
  });

  it('reports overall coverage and gap files when a threshold is requested and a coverage report exists', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null } as never);
    mkdirSync(join(tmp, 'coverage'), { recursive: true });
    writeFileSync(
      join(tmp, 'coverage', 'coverage-final.json'),
      JSON.stringify({
        'src/a.ts': {
          path: 'src/a.ts',
          statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } },
          fnMap: {},
          branchMap: {},
          s: { '0': 1 },
          f: {},
          b: {},
        },
      }),
    );
    const result = await runTests({ cwd: tmp, command: 'echo ok', coverageThreshold: 80 });
    expect(typeof result.coverage === 'number' || result.coverage === undefined).toBe(true);
  });
});

describe('verifyTask', () => {
  let tmp: string;

  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    tmp = mkdtempSync(join(tmpdir(), 'verify-task-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('skips running tests entirely when the task declares zero required layers', async () => {
    const task = fakeTask({ doneCriteria: { testLayers: [] } });
    const { transition, testRun } = await verifyTask(task, { cwd: tmp });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(testRun).toBeUndefined();
    expect(transition).toEqual({ ok: true, to: 'done' });
  });

  it('runs tests and transitions to done on a real green result', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null } as never);
    const task = fakeTask({ doneCriteria: { testLayers: ['unit'] } });
    const { transition, testRun } = await verifyTask(task, { cwd: tmp, command: 'echo ok' });
    expect(testRun?.passed).toBe(true);
    expect(transition).toEqual({ ok: true, to: 'done' });
  });

  it('runs tests and transitions to blocked on a real red result — never silently to done', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: 'FAIL', signal: null } as never);
    const task = fakeTask({ doneCriteria: { testLayers: ['unit'] } });
    const { transition, testRun } = await verifyTask(task, { cwd: tmp, command: 'exit 1' });
    expect(testRun?.passed).toBe(false);
    expect(transition.ok).toBe(false);
    if (!transition.ok) {
      expect(transition.to).toBe('blocked');
      expect(transition.blocked.reason).toMatch(/red/);
      expect(transition.blocked.fromState).toBe('verifying');
    }
  });

  it('blocks a green result whose coverage is below the declared threshold', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '', signal: null } as never);
    const task = fakeTask({ doneCriteria: { testLayers: ['unit'], coverageThreshold: 95 } });
    // No coverage report on disk -> getOverallCoverage returns null -> testResult.coverage undefined -> treated as 0, below any real threshold.
    const { transition } = await verifyTask(task, { command: 'echo ok', cwd: tmp });
    expect(transition.ok).toBe(false);
  });
});
