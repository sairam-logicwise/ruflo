---
id: TASK-006
title: Add a files field to docops package.json
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.166Z
updatedAt: 2026-09-23T06:20:04.166Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 482
  highTokens: 724
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 486
  outputTokens: 117
  costUsd: 0.003213
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: ec8c6fe2f52fb34c118dd70d392e0b08e8c0aacef5e793b2bd738e8e49ebe604
provenance: agent-inferred
---

Pilot task for T8 calibration (config, small).

This package.json has no "files" field. So `npm publish` would ship everything not covered by .npmignore/.gitignore. That includes tests and the vendor/ reference material, meant to stay a dev-time reference, not a runtime dependency of consumers. Propose a "files" array scoped to what a consumer actually needs: dist, package.json itself, license and attribution. Show the JSON change.

## Model response

Confirmed: no "files" field exists. npm publish would ship everything not excluded by .npmignore or .gitignore. That includes vendor/. ATTRIBUTION.md calls it "reference-only... nothing shells out to it," a dev-time artifact, not a runtime dependency. It also includes __tests__/ and scripts/. Add a files field, matching the sibling @claude-flow/cli package's own convention:

```json
"files": ["dist", "!dist/**/*.map", "!dist/**/*.tsbuildinfo", "package.json", "LICENSE", "ATTRIBUTION.md"]
```

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

