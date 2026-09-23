---
id: TASK-013
title: Add a unit test for resolveExecutionProvider's inherit tier under the openrouter provider
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.193Z
updatedAt: 2026-09-23T06:20:04.193Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 15287
  highTokens: 22931
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 18904
  outputTokens: 205
  costUsd: 0.059787
contentHash: fb5b76b63b971219d17763b470fe012230ff4d037fd71c107da8d042451e59cb
provenance: agent-inferred
---

Pilot task for T8 calibration (test-writing, small).

The existing C4 regression test's "every tier that has an OpenRouter alt prices without throwing" case loops over [haiku, sonnet, opus, inherit]. No test asserts specifically what the "inherit" tier resolves to under CLAUDE_FLOW_ROUTER_PROVIDER=openrouter. Does it get its own alt entry, or fall back to the label? Write one focused test for that, matching this file's existing style.

## Model response

I checked the real shipped assets/model-router/openrouter-alts.json. The inherit tier has its own dedicated entry: openrouter_alt is "anthropic/claude-sonnet-4-6". Its own rationale field says why: "inherit is the caller-defined default; we don't override it. Both paths map to Sonnet 4.6." It does not fall back to sonnet's own alt, openai/gpt-4.1. New test, in the existing "resolveExecutionProvider + costUsd composition (C4)" describe block:

```ts
it('the inherit tier resolves to its own dedicated OpenRouter alt, not a fallback to sonnet\'s', () => {
  process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';
  const exec = resolveExecutionProvider('inherit');
  expect(exec.provider).toBe('openrouter');
  expect(exec.openrouterModel).toBe('anthropic/claude-sonnet-4-6');
});
```

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

