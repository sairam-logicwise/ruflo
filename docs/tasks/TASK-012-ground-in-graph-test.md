---
id: TASK-012
title: Add a direct unit test for the standalone groundInGraph export
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.182Z
updatedAt: 2026-09-23T06:20:04.182Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 3924
  highTokens: 5886
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 4573
  outputTokens: 332
  costUsd: 0.018699
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: 85521d1a136ce070d080544fa96bb0e0c042840dc9b5e08ca9d1bc5a2769424f
provenance: agent-inferred
---

Pilot task for T8 calibration (test-writing, small).

features.ts exports groundInGraph() for decompose.ts to reuse. The existing test file only exercises it indirectly, through extractFeatures(). Write 2-3 focused vitest cases that call groundInGraph() directly. Use a fixture graph.json on disk via mkdtempSync, matching this file's existing style. Cover a real match, no graph on disk, and text with no keywords.

## Model response

features.ts exports groundInGraph for decompose.ts to reuse. The existing test file only exercises it indirectly, through extractFeatures. Adding 3 focused cases that call groundInGraph directly, reusing this file's existing writeGraph and graphNode helpers:

```ts
import { groundInGraph } from '../../../src/ruvector/estimator/features.js';

describe('groundInGraph', () => {
  let repoRoot: string;
  beforeEach(() => { repoRoot = mkdtempSync(join(tmpdir(), 'ground-')); });
  afterEach(() => { rmSync(repoRoot, { recursive: true, force: true }); });

  it('matches a real node directly, not just through extractFeatures', () => {
    const graphPath = writeGraph(repoRoot, [graphNode({ label: 'pricing.ts', norm_label: 'pricing.ts', source_file: 'src/pricing.ts' })]);
    expect(groundInGraph('Fix the pricing calculation', graphPath)).toEqual(['src/pricing.ts']);
  });

  it('returns no matches when there is no graph on disk', () => {
    expect(groundInGraph('Fix pricing bugs', join(repoRoot, 'does-not-exist.json'))).toEqual([]);
  });

  it('returns no matches for text with no keywords overlapping any node', () => {
    const graphPath = writeGraph(repoRoot, [graphNode({ label: 'pricing.ts', norm_label: 'pricing.ts', source_file: 'src/pricing.ts' })]);
    expect(groundInGraph('completely unrelated text about weather', graphPath)).toEqual([]);
  });
});
```

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

