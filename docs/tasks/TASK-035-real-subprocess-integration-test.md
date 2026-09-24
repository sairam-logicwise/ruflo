---
id: TASK-035
title: Add one real, unmocked integration test for runTests (review Important 8)
status: done
priority: p2
createdAt: 2026-09-24T11:15:53.614Z
updatedAt: 2026-09-24T11:15:53.614Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 582
  highTokens: 872
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 394
  outputTokens: 333
  costUsd: 0.006177
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
provenance: agent-inferred
contentHash: 668881fe18f0acfaaf87663f63afa8bff0b21e1976807f051dd65c3181cdd593
---

Pilot task for T8 calibration (test-writing, medium).

review-2026-09-23.md Important 8: only unit tests exist — every test mocks spawnSync. Confirm this and propose one real, unmocked integration test.

## Model response

Every test file that touches runTests or verifyTask mocks something. Each one mocks either test-runner.js itself or node:child_process's spawnSync directly. I confirmed this by grepping every __tests__ file that references either function and checking each one for a mock. There are no exceptions. This matches manual verification against a real scratch repo, done earlier this session. It worked, but nobody captured it as a repeatable, automated test.

The fix is small and concrete. Add one real, unmocked integration test:

```ts
it('runTests reports a real exit code from a real subprocess, unmocked', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'real-test-'));
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
  const result = await runTests({ cwd: tmp }); // real spawnSync, not vi.mock('node:child_process')
  expect(result.exitCode).toBe(0);
  expect(result.passed).toBe(true);
});
```

This doesn't replace the mocked unit tests. They still cover command resolution and timeout logic correctly. It closes one real gap: nothing in CI currently proves a real exit code reaches a real TestRunResult.

---
_Actuals note: this session's own model did this task directly. It ran multiple real tool calls (file reads, greps) against the real repository. It did not answer in one shot.

`inputTokens`/`outputTokens` come from a local tokenizer count over the full transcript of that work. Every real tool result read counts as input. Every real tool call issued, plus the final written response, counts as output. This is not just one prompt/response pair.

That count is approximate. It is not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price — the nearest entry in model-prices.ts to this session's real model. This labels the record by the model that actually did the work._

