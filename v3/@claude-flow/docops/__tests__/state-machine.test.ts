/**
 * T15 (agentic SDLC plan) — task lifecycle state machine.
 */

import { describe, it, expect } from 'vitest';
import {
  TASK_STATES,
  nextState,
  attemptTransition,
  resumeFromBlocked,
  isLegalTransition,
  type TaskState,
  type ResumableState,
} from '../src/state-machine.js';
import { TaskSchema, type Task } from '../src/schemas/task.js';
import { computeContentHash } from '../src/content-hash.js';

const now = '2026-09-21T00:00:00.000Z';
const hash = computeContentHash('body');
const ACCEPTED = { citationAcceptance: { allAccepted: true, unacceptedIds: [] } };

function task(overrides: Partial<Record<string, unknown>> = {}): Task {
  const raw = {
    id: 'TASK-001',
    title: 'Fix inherited pricing bugs',
    status: 'drafted',
    priority: 'p1',
    createdAt: now,
    updatedAt: now,
    citations: ['REQ-001'],
    dependsOn: [],
    contentHash: hash,
    provenance: 'human',
    ...overrides,
  };
  const result = TaskSchema.safeParse(raw);
  if (!result.success) throw new Error(`test fixture does not validate: ${result.error.message}`);
  return result.data;
}

describe('TASK_STATES', () => {
  it('is exactly the six states from plan.md Task 15', () => {
    expect([...TASK_STATES].sort()).toEqual(
      ['blocked', 'done', 'drafted', 'implementing', 'specified', 'verifying'].sort(),
    );
  });
});

describe('nextState', () => {
  it('maps each resumable state to its one forward target', () => {
    expect(nextState('drafted')).toBe('specified');
    expect(nextState('specified')).toBe('implementing');
    expect(nextState('implementing')).toBe('verifying');
    expect(nextState('verifying')).toBe('done');
  });
});

describe('attemptTransition — legal forward path', () => {
  it('drafted -> specified succeeds once an estimate is recorded and citations are accepted', () => {
    const t = task({ estimate: { lowTokens: 100, highTokens: 500, confidence: 0.6 } });
    const result = attemptTransition(t, 'drafted', ACCEPTED);
    expect(result).toEqual({ ok: true, to: 'specified' });
  });

  it('specified -> implementing succeeds once doneCriteria is declared, even with an empty testLayers list', () => {
    const t = task({ doneCriteria: { testLayers: [] } });
    const result = attemptTransition(t, 'specified');
    expect(result).toEqual({ ok: true, to: 'implementing' });
  });

  it('implementing -> verifying has no structural gate beyond leaving implementing', () => {
    const t = task();
    const result = attemptTransition(t, 'implementing');
    expect(result).toEqual({ ok: true, to: 'verifying' });
  });

  it('verifying -> done succeeds with no test result when doneCriteria declares zero required layers', () => {
    const t = task({ doneCriteria: { testLayers: [] } });
    const result = attemptTransition(t, 'verifying');
    expect(result).toEqual({ ok: true, to: 'done' });
  });

  it('verifying -> done succeeds with a passing, sufficient-coverage test result when layers are required', () => {
    const t = task({ doneCriteria: { testLayers: ['unit'], coverageThreshold: 80 } });
    const result = attemptTransition(t, 'verifying', { testResult: { passed: true, coverage: 85 } });
    expect(result).toEqual({ ok: true, to: 'done' });
  });

  it('verifying -> done succeeds with a passing result when doneCriteria sets no coverage threshold at all', () => {
    const t = task({ doneCriteria: { testLayers: ['unit'] } });
    const result = attemptTransition(t, 'verifying', { testResult: { passed: true } });
    expect(result).toEqual({ ok: true, to: 'done' });
  });
});

describe('attemptTransition — AD-4: a failed precondition routes to blocked, never to done, and never leaves "failed"', () => {
  it('drafted -> specified blocks with no estimate recorded, given accepted citations', () => {
    const t = task();
    const result = attemptTransition(t, 'drafted', ACCEPTED);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.to).toBe('blocked');
      expect(result.blocked.fromState).toBe('drafted');
      expect(result.blocked.reason).toMatch(/no estimate/);
      expect(result.blocked.unblockCondition.length).toBeGreaterThan(0);
    }
  });

  it('T16: drafted -> specified blocks when citation acceptance was never checked at all — fails closed, no free pass', () => {
    const t = task({ estimate: { lowTokens: 100, highTokens: 500, confidence: 0.6 } });
    const result = attemptTransition(t, 'drafted');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocked.reason).toMatch(/not checked/);
    }
  });

  it('T16: drafted -> specified blocks and names every unaccepted cited record', () => {
    const t = task({ estimate: { lowTokens: 100, highTokens: 500, confidence: 0.6 } });
    const result = attemptTransition(t, 'drafted', {
      citationAcceptance: { allAccepted: false, unacceptedIds: ['REQ-001', 'DEC-002'] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocked.reason).toContain('REQ-001');
      expect(result.blocked.reason).toContain('DEC-002');
      expect(result.blocked.unblockCondition).toContain('REQ-001');
    }
  });

  it('specified -> implementing blocks with no doneCriteria declared at all (undefined, not just empty)', () => {
    const t = task();
    const result = attemptTransition(t, 'specified');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocked.fromState).toBe('specified');
      expect(result.blocked.reason).toMatch(/no done criteria/);
    }
  });

  it('verifying -> done blocks when required layers are declared but no test result was supplied at all', () => {
    const t = task({ doneCriteria: { testLayers: ['unit', 'integration'] } });
    const result = attemptTransition(t, 'verifying');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocked.reason).toMatch(/no test result/);
      expect(result.blocked.unblockCondition).toContain('unit');
      expect(result.blocked.unblockCondition).toContain('integration');
    }
  });

  it('verifying -> done blocks on a red test result — never silently advances to done', () => {
    const t = task({ doneCriteria: { testLayers: ['unit'] } });
    const result = attemptTransition(t, 'verifying', { testResult: { passed: false } });
    expect(result).toEqual({
      ok: false,
      to: 'blocked',
      blocked: { reason: 'the test result is red', unblockCondition: expect.stringMatching(/fix/), fromState: 'verifying' },
    });
  });

  it('verifying -> done blocks when coverage is below the declared threshold, even with a green result', () => {
    const t = task({ doneCriteria: { testLayers: ['unit'], coverageThreshold: 90 } });
    const result = attemptTransition(t, 'verifying', { testResult: { passed: true, coverage: 70 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocked.reason).toContain('70%');
      expect(result.blocked.reason).toContain('90%');
    }
  });

  it('a blocked verdict always names a fromState that resumeFromBlocked can use to get back to a real, resumable state', () => {
    const t = task();
    const result = attemptTransition(t, 'drafted', ACCEPTED);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const resumed = resumeFromBlocked(result.blocked);
      expect(TASK_STATES).toContain(resumed);
      expect(resumed).not.toBe('blocked');
      expect(resumed).not.toBe('done');
    }
  });
});

describe('isLegalTransition — full matrix', () => {
  const allPairs: Array<[TaskState, TaskState]> = [];
  for (const from of TASK_STATES) for (const to of TASK_STATES) allPairs.push([from, to]);

  const legal = new Set([
    'drafted->specified',
    'specified->implementing',
    'implementing->verifying',
    'verifying->done',
    'drafted->blocked',
    'specified->blocked',
    'implementing->blocked',
    'verifying->blocked',
    'blocked->drafted',
    'blocked->specified',
    'blocked->implementing',
    'blocked->verifying',
  ]);

  it.each(allPairs)('%s -> %s matches the expected legal/illegal verdict', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(legal.has(`${from}->${to}`));
  });

  it('done has no outgoing transitions at all, including to itself', () => {
    for (const to of TASK_STATES) expect(isLegalTransition('done', to)).toBe(false);
  });

  it('blocked can never resume directly into blocked or straight into done', () => {
    expect(isLegalTransition('blocked', 'blocked')).toBe(false);
    expect(isLegalTransition('blocked', 'done')).toBe(false);
  });

  it('no state can transition into itself as a no-op (other than blocked resuming, which is excluded above)', () => {
    for (const s of TASK_STATES) {
      if (s === 'blocked') continue;
      expect(isLegalTransition(s, s)).toBe(false);
    }
  });
});
