/**
 * T20 (agentic SDLC plan) — the bounded wrapper around
 * plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs. Every real
 * `claude -p` spawn is mocked out via `node:child_process`'s `spawnSync` —
 * this suite proves the wrapper's OWN logic (bounding, repeated-failure
 * short-circuit, budget cap, dry-run) never actually shells out, spending
 * $0 regardless of what environment it runs in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

import { spawnSync } from 'node:child_process';
import { runRepairLoop } from '../../src/ruvector/repair-loop.js';

function jsonResult(data: Record<string, unknown>, success: boolean, status = success ? 0 : 1) {
  return { status, stdout: JSON.stringify({ success, data }), stderr: '', signal: null } as never;
}

describe('runRepairLoop', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
  });

  it('never spawns anything without --confirm — dry run only', () => {
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: false });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('dry-run');
    expect(result.repaired).toBe(false);
    expect(result.attempts).toEqual([]);
    expect(result.plan).toMatchObject({ testCommand: 'npm test' });
  });

  it('stops on the first round that reports success', () => {
    vi.mocked(spawnSync).mockReturnValue(jsonResult({ after: { passed: true }, totalCostUsd: 0.05 }, true));
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true, maxAttempts: 3 });
    expect(result.repaired).toBe(true);
    expect(result.stopReason).toBe('repaired');
    expect(result.attempts).toHaveLength(1);
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it('pins each spawn to exactly one internal tdd-repair attempt, letting the wrapper own the outer loop', () => {
    vi.mocked(spawnSync).mockReturnValue(jsonResult({ after: { passed: true }, totalCostUsd: 0.05 }, true));
    runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true });
    const args = vi.mocked(spawnSync).mock.calls[0][1] as string[];
    expect(args).toContain('--max-attempts');
    expect(args[args.indexOf('--max-attempts') + 1]).toBe('1');
    expect(args).toContain('--confirm');
  });

  it('stops after the SAME failure twice in a row, never reaching a third attempt', () => {
    vi.mocked(spawnSync).mockReturnValue(
      jsonResult({ after: { passed: false, output: 'TypeError: x is not a function' }, totalCostUsd: 0.1 }, false),
    );
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true, maxAttempts: 5, budgetUsd: 100 });
    expect(result.stopReason).toBe('repeated-failure');
    expect(result.attempts).toHaveLength(2); // round 1 establishes the hash, round 2 repeats it and stops
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying while each failure differs from the last, up to maxAttempts', () => {
    let call = 0;
    vi.mocked(spawnSync).mockImplementation(
      () => jsonResult({ after: { passed: false, output: `attempt ${++call} failed differently` }, totalCostUsd: 0.01 }, false),
    );
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true, maxAttempts: 3, budgetUsd: 100 });
    expect(result.stopReason).toBe('max-attempts-exhausted');
    expect(result.attempts).toHaveLength(3);
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it('stops once cumulative cost reaches the budget, even with attempts left', () => {
    let call = 0;
    vi.mocked(spawnSync).mockImplementation(
      () => jsonResult({ after: { passed: false, output: `differs ${++call}` }, totalCostUsd: 3 }, false),
    );
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true, maxAttempts: 5, budgetUsd: 5 });
    expect(result.stopReason).toBe('budget-exhausted');
    expect(result.totalCostUsd).toBeGreaterThanOrEqual(5);
    expect(spawnSync).toHaveBeenCalledTimes(2); // 3 + 3 >= 5, stops after round 2
  });

  it('treats unparseable stdout as tdd-repair being unavailable, without burning further attempts', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: 'not json', stderr: 'boom', signal: null } as never);
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true, maxAttempts: 3 });
    expect(result.stopReason).toBe('tdd-repair-unavailable');
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it('treats a missing claude CLI as unavailable, not a failed repair round', () => {
    vi.mocked(spawnSync).mockReturnValue(jsonResult({ reason: 'claude-cli-not-installed' }, false, 3));
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true });
    expect(result.stopReason).toBe('tdd-repair-unavailable');
  });

  it('treats a tdd-repair config error (exit 2) as a config problem, not a failed repair round', () => {
    vi.mocked(spawnSync).mockReturnValue(jsonResult({ reason: 'test-command-required' }, false, 2));
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true });
    expect(result.stopReason).toBe('tdd-repair-config-error');
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it('carries the last failing output forward for an exhausted repair, so nothing is a dead end', () => {
    let call = 0;
    vi.mocked(spawnSync).mockImplementation(
      () => jsonResult({ after: { passed: false, output: `distinct failure ${++call}` }, totalCostUsd: 0.01 }, false),
    );
    const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true, maxAttempts: 2, budgetUsd: 100 });
    expect(result.lastOutput).toContain('distinct failure 2');
  });

  // T13: real token capture from tdd-repair.mjs's own attempts[0].claude.usage.
  describe('real token capture (T13)', () => {
    it('reads input/output tokens from a successful round and sums them onto the result', () => {
      vi.mocked(spawnSync).mockReturnValue(jsonResult({
        after: { passed: true },
        totalCostUsd: 0.2,
        attempts: [{ claude: { usage: { input_tokens: 1200, output_tokens: 300 } } }],
      }, true));
      const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true });
      expect(result.attempts[0].inputTokens).toBe(1200);
      expect(result.attempts[0].outputTokens).toBe(300);
      expect(result.totalInputTokens).toBe(1200);
      expect(result.totalOutputTokens).toBe(300);
    });

    it('sums tokens across multiple real rounds, not just the last one', () => {
      let call = 0;
      vi.mocked(spawnSync).mockImplementation(() => {
        call++;
        const passed = call === 3;
        return jsonResult({
          after: { passed, output: passed ? undefined : `differs ${call}` },
          totalCostUsd: 0.1,
          attempts: [{ claude: { usage: { input_tokens: 1000 * call, output_tokens: 100 * call } } }],
        }, passed);
      });
      const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true, maxAttempts: 5, budgetUsd: 100 });
      expect(result.stopReason).toBe('repaired');
      expect(result.attempts).toHaveLength(3);
      expect(result.totalInputTokens).toBe(1000 + 2000 + 3000);
      expect(result.totalOutputTokens).toBe(100 + 200 + 300);
    });

    it('leaves totalInputTokens/totalOutputTokens undefined — not 0 — when a round never produced usage', () => {
      vi.mocked(spawnSync).mockReturnValue(jsonResult({ after: { passed: true }, totalCostUsd: 0.05 }, true));
      const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true });
      expect(result.totalInputTokens).toBeUndefined();
      expect(result.totalOutputTokens).toBeUndefined();
      expect(result.attempts[0].inputTokens).toBeUndefined();
      expect(result.attempts[0].outputTokens).toBeUndefined();
    });

    it('stays undefined on tdd-repair-unavailable — no round ever ran far enough to produce usage', () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: 'not json', stderr: 'boom', signal: null } as never);
      const result = runRepairLoop({ repo: '/tmp/x', testCommand: 'npm test', confirm: true });
      expect(result.totalInputTokens).toBeUndefined();
      expect(result.totalOutputTokens).toBeUndefined();
    });
  });
});
