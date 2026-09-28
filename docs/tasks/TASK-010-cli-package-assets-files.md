---
id: TASK-010
title: Add assets/ to the CLI package.json files array
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.177Z
updatedAt: 2026-09-23T06:20:04.177Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 1707
  highTokens: 2561
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 1988
  outputTokens: 146
  costUsd: 0.008154
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: 9b3f757418739cb510881950c2707bc5274a3153a326011d901ff44be7c14c78
provenance: agent-inferred
---

Pilot task for T8 calibration (bug-fix, medium).

This package.json's "files" array lists dist, bin, scripts/postinstall.cjs, .claude, plugins, README.md, and catalog-manifest.json. It does not list assets/. model-router.ts and neural-router.ts both resolve real runtime assets (openrouter-alts.json, the bundled KRR/calibrator artifacts) from a package-relative assets/ directory. A real `npm publish` would likely omit assets/ entirely, breaking that resolution for every installed copy. Propose the files-array fix. Show the JSON change.

## Model response

Confirmed: model-router.ts's loadOpenRouterAlts resolves a real runtime asset from a package-relative assets/ directory. The same convention applies to neural-router.ts. The "files" array omits assets/. A real npm publish would ship without it. That would break asset resolution for every installed copy. It would fall back to {provider:'openrouter'} with no openrouterModel, silently losing the C4 pricing fix. Add "assets" to the array:

```json
"files": ["dist", "!dist/**/*.map", "!dist/**/*.tsbuildinfo", "bin", "assets", "scripts/postinstall.cjs", ".claude", "plugins", "README.md", "catalog-manifest.json"]
```

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

