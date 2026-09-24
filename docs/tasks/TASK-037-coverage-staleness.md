---
id: TASK-037
title: Stop serving stale coverage evidence after a real test run (review Important 10)
status: done
priority: p2
createdAt: 2026-09-24T11:15:53.617Z
updatedAt: 2026-09-24T11:15:53.617Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 678
  highTokens: 1018
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 542
  outputTokens: 306
  costUsd: 0.006216
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
provenance: agent-inferred
contentHash: 86a800c64f7a57eea1ae79b59cf1953726757d16704d0e7cb8371a413cfbc0e2
---

Pilot task for T8 calibration (bug-fix, medium).

review-2026-09-23.md Important 10: coverage evidence can be stale — runTests never adds a coverage flag and reads whatever is on disk, with caching on. Confirm and propose a fix.

## Model response

I found two real staleness sources by reading the code. First, runTests (test-runner.ts:88) spawns the resolved command as-is. It never appends a coverage flag. So whatever report ends up on disk depends entirely on whether the project's own test command already runs with coverage on. Second, even when a report is freshly written, the code calls getOverallCoverage (line 109) without skipCache. loadProjectCoverage (coverage-router.ts) caches for a full minute. Two verify calls inside that window can read an already-stale number, even after a real, fresh test run.

The second has a precise, one-line fix:

```ts
const [overall, gaps] = await Promise.all([
  getOverallCoverage(cwd, true), // skipCache — this run's own test command just finished; never serve a stale number here
  coverageGaps({ projectRoot: cwd, threshold: opts.coverageThreshold, skipCache: true }),
]);
```

The first is harder to fix generically, since coverage flags differ by test framework. The honest minimal step there is a staleness check, not a guess. Compare the coverage report's own mtime against `start` (already captured, line 87). Treat an OLDER report as coverage: null, rather than trusting it silently.

---
_Actuals note: this session's own model did this task directly. It ran multiple real tool calls (file reads, greps) against the real repository. It did not answer in one shot.

`inputTokens`/`outputTokens` come from a local tokenizer count over the full transcript of that work. Every real tool result read counts as input. Every real tool call issued, plus the final written response, counts as output. This is not just one prompt/response pair.

That count is approximate. It is not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price — the nearest entry in model-prices.ts to this session's real model. This labels the record by the model that actually did the work._

