/**
 * state-machine.ts — the task lifecycle (T15, agentic SDLC plan,
 * tasks/plan.md). This is the object T16's phase gate enforces against:
 * without a defined state machine, "mandatory step" has no definition to
 * point at.
 *
 * Six states: drafted, specified, implementing, verifying, done, blocked.
 * A forward transition (drafted→specified→implementing→verifying→done) is
 * guarded by a precondition — a pure function of the task record (and, for
 * verifying→done, an explicit test-result context, since that evidence
 * can't come from the record alone). AD-4: a failed precondition routes to
 * `blocked`, never silently stays put and never reaches `done` — modelling
 * `blocked` as a real state with a named reason and unblock condition is
 * what makes escalation legible (plan.md Task 15's own rationale), and it
 * is the reason there is no separate "failed" state at all: a failure IS
 * a transition to `blocked`, which is never terminal (it always carries a
 * `fromState` to resume into once its condition is met).
 *
 * `verifying → done`'s real precondition (tests green, coverage above
 * threshold) needs a live test-run result T19 hasn't built yet. Rather
 * than fake that evidence or leave the transition unimplemented, the
 * precondition here fails CLOSED when no test result is supplied — a task
 * declaring at least one required test layer (T18's doneCriteria) cannot
 * reach `done` without real evidence, by construction, from day one. A
 * task that deliberately declares zero required test layers (a config-only
 * change, say) is exempt — that is T18's whole point: the bar is declared
 * per task, not a single global one.
 *
 * @module state-machine
 */

import type { Task } from './schemas/task.js';

export const TASK_STATES = ['drafted', 'specified', 'implementing', 'verifying', 'done', 'blocked'] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** The state a transition attempt was made FROM — every non-terminal, non-blocked state. */
export type ResumableState = Exclude<TaskState, 'blocked' | 'done'>;

export interface BlockedInfo {
  /** Why the transition failed — human-readable, specific to this task. */
  reason: string;
  /** What would need to become true to unblock — actionable, not just a restatement of the reason. */
  unblockCondition: string;
  /** The state to resume into once unblocked. */
  fromState: ResumableState;
}

/**
 * T16: whether the task's cited REQ/DEC records are actually `accepted` —
 * not still `draft`, not `superseded`. Derived from OTHER records on disk,
 * which this package deliberately has no access to (it stays storage-free
 * — see AD-1/module doc), so the caller must read them and supply the
 * verdict, same pattern T19 established for `testResult`.
 */
export interface CitationAcceptance {
  allAccepted: boolean;
  /** The cited ids that are NOT accepted (missing, still draft, or superseded) — named so the denial can say exactly what to fix. */
  unacceptedIds: string[];
}

/** Evidence a precondition can't derive from the task record alone. Supplied by the caller (T19 supplies testResult once it exists; T16 supplies citationAcceptance). */
export interface TransitionContext {
  testResult?: { passed: boolean; coverage?: number };
  citationAcceptance?: CitationAcceptance;
}

export type TransitionResult =
  | { ok: true; to: TaskState }
  | { ok: false; to: 'blocked'; blocked: BlockedInfo };

type PreconditionVerdict = { ok: true } | { ok: false; reason: string; unblockCondition: string };
type Precondition = (task: Task, context: TransitionContext) => PreconditionVerdict;

/** The only legal FORWARD edge out of each non-terminal, non-blocked state. `done` and `blocked` are handled separately below. */
const FORWARD: Record<ResumableState, TaskState> = {
  drafted: 'specified',
  specified: 'implementing',
  implementing: 'verifying',
  verifying: 'done',
};

/**
 * One precondition per forward-transition TARGET (i.e. "what must be true
 * to ENTER this state"), keyed the same way FORWARD's values are named.
 */
const PRECONDITIONS: Record<Exclude<TaskState, 'drafted' | 'blocked'>, Precondition> = {
  // T16: fails CLOSED when citationAcceptance isn't supplied at all — same
  // "no free pass" reasoning T19 used for testResult. A task's citations
  // are ALWAYS present (the citation contract, T3, requires at least one),
  // so unlike testResult this evidence is never conditionally optional —
  // every caller attempting drafted -> specified must have actually
  // checked. Advancing a task whose justifying REQ/DEC was never accepted
  // is exactly the "mandatory step cannot be skipped" Requirement 6 names.
  specified: (task, context) => {
    if (!context.citationAcceptance) {
      return {
        ok: false,
        reason: 'citation acceptance was not checked before this attempt',
        unblockCondition: 'the caller must verify every cited requirement/decision is accepted and supply that evidence before attempting this transition',
      };
    }
    if (!context.citationAcceptance.allAccepted) {
      const ids = context.citationAcceptance.unacceptedIds.join(', ');
      return {
        ok: false,
        reason: `cited record(s) not accepted: ${ids}`,
        unblockCondition: `accept ${ids} (set its status to "accepted") before this task can be specified, or cite an already-accepted record instead`,
      };
    }
    return task.estimate
      ? { ok: true }
      : { ok: false, reason: 'no estimate recorded', unblockCondition: 'record an estimate (low/high tokens and a confidence level) on this task' };
  },

  implementing: (task) =>
    task.doneCriteria
      ? { ok: true }
      : {
          ok: false,
          reason: 'no done criteria declared',
          unblockCondition: 'set doneCriteria on this task — which test layers apply (an empty list is a valid, deliberate choice) and an optional coverage threshold',
        },

  verifying: () => ({ ok: true }), // no structural gate beyond having left `implementing` — an agent/human signals readiness to verify

  done: (task, context) => {
    const requiredLayers = task.doneCriteria?.testLayers ?? [];
    if (requiredLayers.length === 0) return { ok: true }; // task declared it needs no tests — T18's per-task bar, not a global one

    if (!context.testResult) {
      return {
        ok: false,
        reason: `doneCriteria requires ${requiredLayers.join(', ')} but no test result was supplied`,
        unblockCondition: `run the required test layers (${requiredLayers.join(', ')}) and re-attempt with the result`,
      };
    }
    if (!context.testResult.passed) {
      return { ok: false, reason: 'the test result is red', unblockCondition: 'fix the failing tests, then re-run verification' };
    }
    const threshold = task.doneCriteria?.coverageThreshold;
    if (threshold != null && (context.testResult.coverage ?? 0) < threshold) {
      return {
        ok: false,
        reason: `coverage ${context.testResult.coverage ?? 0}% is below the required ${threshold}%`,
        unblockCondition: `raise coverage to at least ${threshold}%`,
      };
    }
    return { ok: true };
  },
};

/** The state a forward transition from `current` would land in, or undefined if `current` has no forward edge (`done`). */
export function nextState(current: ResumableState): TaskState {
  return FORWARD[current];
}

/**
 * Attempts the one legal forward transition out of `currentState`. On a
 * failed precondition, returns a `blocked` result carrying WHY and WHAT
 * would unblock it (never silently stays put, never reaches `done`) — the
 * caller is responsible for actually writing the resulting state back to
 * the task record; this function only decides what that state should be.
 */
export function attemptTransition(task: Task, currentState: ResumableState, context: TransitionContext = {}): TransitionResult {
  const target = FORWARD[currentState];
  const verdict = PRECONDITIONS[target](task, context);
  if (verdict.ok) return { ok: true, to: target };
  return {
    ok: false,
    to: 'blocked',
    blocked: { reason: verdict.reason, unblockCondition: verdict.unblockCondition, fromState: currentState },
  };
}

/** The state to resume a blocked task into, once its unblock condition is met. Not itself a validity check — the caller decides when that condition actually holds. */
export function resumeFromBlocked(blocked: BlockedInfo): ResumableState {
  return blocked.fromState;
}

/**
 * Whether `from -> to` is a legal edge in this state machine at all
 * (ignoring precondition outcome — this is structure, not evidence).
 * `done` has no outgoing edges. `blocked` can resume into any non-terminal
 * state (in practice, always its own recorded `fromState`); any
 * non-terminal state can transition into `blocked` (a failed precondition
 * can happen from any of them) but never into itself as a no-op.
 */
export function isLegalTransition(from: TaskState, to: TaskState): boolean {
  if (from === 'done') return false;
  if (to === 'blocked') return from !== 'blocked';
  if (from === 'blocked') return to !== 'done'; // resume into a working state, not straight to done (to !== 'blocked' already holds — narrowed above)
  return (FORWARD as Record<TaskState, TaskState | undefined>)[from] === to;
}
