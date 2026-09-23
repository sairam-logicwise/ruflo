---
id: TASK-005
title: Fix docops tsconfig.json include gap for scripts/ and __tests__/
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.164Z
updatedAt: 2026-09-23T06:20:04.164Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 338
  highTokens: 508
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 226
  outputTokens: 197
  costUsd: 0.003633
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: b00abbc97d19f59903212e839c173120e30b36510324159bde29c09987bccd7e
provenance: agent-inferred
---

Pilot task for T8 calibration (config, small).

This tsconfig.json's "include" is ["src/**/*"]. That leaves scripts/ and __tests__/ untypechecked by `npm run build`. A type error in either would only surface when vitest happens to run them, never at build time. Propose the include-array fix. Show the corrected JSON.

## Model response

Confirmed: include is ["src/**/*"]. This leaves scripts/ and __tests__/ untypechecked by npm run build (tsc). The naive fix, adding them to include, would break the real build. This tsconfig also sets rootDir: ./src. tsc throws TS6059 ("File is not under rootDir") the moment a file outside src/ joins the same compile. The correct minimal fix adds a separate typecheck-only config, leaving the build one alone:

```json
// tsconfig.typecheck.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src/**/*", "scripts/**/*", "__tests__/**/*"]
}
```

Run it via tsc -p tsconfig.typecheck.json --noEmit. Add it as a CI or pre-commit step alongside the real npm run build, not instead of it.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

