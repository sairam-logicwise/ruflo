/**
 * T3 (agentic SDLC plan) — record schema tests.
 * Covers the verification bullet literally: valid record, missing
 * citation, unknown field, bad status. Run with:
 *   npm test -- --grep "record schema"
 */

import { describe, it, expect } from 'vitest';
import { RequirementSchema } from '../src/schemas/requirement.js';
import { DecisionSchema } from '../src/schemas/decision.js';
import { TaskSchema } from '../src/schemas/task.js';
import { computeContentHash } from '../src/content-hash.js';

const now = '2026-09-21T00:00:00.000Z';
const hash = computeContentHash('some body text');

function validRequirement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'REQ-001',
    title: 'Quote a feature before building it',
    status: 'accepted',
    createdAt: now,
    updatedAt: now,
    citations: [],
    contentHash: hash,
    provenance: 'human',
    supersedes: [],
    ...overrides,
  };
}

function validDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DEC-001',
    title: 'The record is the gate, not the prompt',
    status: 'accepted',
    createdAt: now,
    updatedAt: now,
    citations: ['REQ-001'],
    contentHash: hash,
    provenance: 'human',
    supersedes: [],
    related: [],
    ...overrides,
  };
}

function validTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'TASK-001',
    title: 'Fix inherited pricing and tokenizer bugs',
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
}

describe('record schema — valid record', () => {
  it('accepts a well-formed requirement', () => {
    const result = RequirementSchema.safeParse(validRequirement());
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed decision citing a requirement', () => {
    const result = DecisionSchema.safeParse(validDecision());
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed task citing a requirement', () => {
    const result = TaskSchema.safeParse(validTask());
    expect(result.success).toBe(true);
  });

  it('accepts a task citing a decision instead of a requirement', () => {
    const result = TaskSchema.safeParse(validTask({ citations: ['DEC-001'] }));
    expect(result.success).toBe(true);
  });

  it('accepts a task with estimate/actuals/doneCriteria populated', () => {
    const result = TaskSchema.safeParse(
      validTask({
        estimate: { lowTokens: 1000, highTokens: 5000, confidence: 0.6 },
        actuals: { inputTokens: 2000, outputTokens: 800, costUsd: 0.012, source: 'measured', priceModel: 'anthropic/claude-sonnet-4-6' },
        doneCriteria: { testLayers: ['unit', 'integration'], coverageThreshold: 80 },
      }),
    );
    expect(result.success).toBe(true);
  });

  // Review #3, C3/Important 11: actuals must declare whether a cost
  // figure was really metered or approximated — required, not optional.
  it('rejects actuals missing source or priceModel', () => {
    const missingSource = TaskSchema.safeParse(
      validTask({ actuals: { inputTokens: 100, outputTokens: 50, costUsd: 0.001, priceModel: 'anthropic/claude-sonnet-4-6' } }),
    );
    expect(missingSource.success).toBe(false);

    const missingPriceModel = TaskSchema.safeParse(
      validTask({ actuals: { inputTokens: 100, outputTokens: 50, costUsd: 0.001, source: 'measured' } }),
    );
    expect(missingPriceModel.success).toBe(false);
  });

  it('accepts both real actuals sources: proxy and measured', () => {
    for (const source of ['proxy', 'measured'] as const) {
      const result = TaskSchema.safeParse(
        validTask({ actuals: { inputTokens: 100, outputTokens: 50, costUsd: 0.001, source, priceModel: 'anthropic/claude-sonnet-4-6' } }),
      );
      expect(result.success).toBe(true);
    }
  });

  // Review #3, C1: a real verification receipt, persisted on the record.
  it('accepts a task with a well-formed verification receipt', () => {
    const result = TaskSchema.safeParse(
      validTask({
        verification: { command: 'npm test', exitCode: 0, coverage: 82, timestamp: now, gitSha: 'abc1234', contentHash: hash },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a verification receipt missing any required field', () => {
    for (const field of ['command', 'exitCode', 'timestamp', 'gitSha', 'contentHash']) {
      const receipt: Record<string, unknown> = { command: 'npm test', exitCode: 0, timestamp: now, gitSha: 'abc1234', contentHash: hash };
      delete receipt[field];
      const result = TaskSchema.safeParse(validTask({ verification: receipt }));
      expect(result.success).toBe(false);
    }
  });
});

describe('record schema — missing citation (the citation contract)', () => {
  it('rejects a task with an empty citations array', () => {
    const result = TaskSchema.safeParse(validTask({ citations: [] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('citations'))).toBe(true);
    }
  });

  it('rejects a task that cites only other tasks, not a requirement or decision', () => {
    const result = TaskSchema.safeParse(validTask({ citations: ['TASK-002'] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/requirement or decision|REQ or DEC/i);
    }
  });

  it('does NOT require citations on a requirement (base contract is task-only)', () => {
    const result = RequirementSchema.safeParse(validRequirement({ citations: [] }));
    expect(result.success).toBe(true);
  });

  it('does NOT require citations on a decision', () => {
    const result = DecisionSchema.safeParse(validDecision({ citations: [] }));
    expect(result.success).toBe(true);
  });
});

describe('record schema — unknown field', () => {
  it('rejects a requirement with an unrecognized key', () => {
    const result = RequirementSchema.safeParse(validRequirement({ madeUpField: 'nope' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('rejects a task with an unrecognized key', () => {
    const result = TaskSchema.safeParse(validTask({ owner: 'someone' }));
    expect(result.success).toBe(false);
  });

  it('rejects an estimate object with an extra field', () => {
    const result = TaskSchema.safeParse(
      validTask({ estimate: { lowTokens: 1, highTokens: 2, confidence: 0.5, unit: 'tokens' } }),
    );
    expect(result.success).toBe(false);
  });
});

describe('record schema — bad status', () => {
  it('rejects a requirement with a status outside the enum', () => {
    const result = RequirementSchema.safeParse(validRequirement({ status: 'in-review' }));
    expect(result.success).toBe(false);
  });

  it('rejects a decision with a status outside the enum', () => {
    const result = DecisionSchema.safeParse(validDecision({ status: 'proposed' }));
    expect(result.success).toBe(false);
  });

  it('rejects a task with a status outside the enum', () => {
    const result = TaskSchema.safeParse(validTask({ status: 'in-progress' }));
    expect(result.success).toBe(false);
  });
});

describe('record schema — id prefix enforcement', () => {
  it('rejects a requirement whose id has the wrong prefix', () => {
    const result = RequirementSchema.safeParse(validRequirement({ id: 'TASK-001' }));
    expect(result.success).toBe(false);
  });

  it('rejects a malformed id entirely', () => {
    const result = TaskSchema.safeParse(validTask({ id: 'not-an-id' }));
    expect(result.success).toBe(false);
  });
});

describe('record schema — estimate range sanity (AD-6: never a point estimate)', () => {
  it('rejects an estimate where highTokens < lowTokens', () => {
    const result = TaskSchema.safeParse(
      validTask({ estimate: { lowTokens: 5000, highTokens: 1000, confidence: 0.5 } }),
    );
    expect(result.success).toBe(false);
  });
});
