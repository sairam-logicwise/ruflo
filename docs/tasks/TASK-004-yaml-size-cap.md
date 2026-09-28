---
id: TASK-004
title: Cap input size before YAML parsing in frontmatter.ts
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.162Z
updatedAt: 2026-09-23T06:20:04.162Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 2144
  highTokens: 3216
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 2497
  outputTokens: 183
  costUsd: 0.010236
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: 003b09f1b95adcb22cce76d5c20573066f5866bf4cbab765e619fbb21f27a539
provenance: agent-inferred
---

Pilot task for T8 calibration (bug-fix, medium).

parseRecordFile parses the extracted frontmatter block with js-yaml, with no size limit. A few-hundred-byte "billion laughs" anchor/alias frontmatter can expand to tens of megabytes in under a millisecond. That is irrelevant for a local checkout. It becomes a real memory-exhaustion vector once record validation runs against untrusted PR content in CI. Propose a size cap on the raw frontmatter block, checked before parsing, with a clear error when exceeded. Show the code change.

## Model response

parseRecordFile calls parseYaml on the raw frontmatter block with no size limit. Add a cap, checked before parsing. Report it the same way malformed YAML already is: via parseError, never a thrown exception. This matches the function's own "never throws" contract.

```ts
const MAX_FRONTMATTER_BYTES = 64 * 1024; // generous — real records run a few KB

const body = raw.slice(match[0].length);
if (match[1].length > MAX_FRONTMATTER_BYTES) {
  return { frontmatter: {}, body, parseError: new Error(`frontmatter block exceeds ${MAX_FRONTMATTER_BYTES} bytes (${match[1].length}) — refusing to parse`) };
}
try {
  const frontmatter = (parseYaml(match[1], { schema: JSON_SCHEMA }) ?? {}) as Record<string, unknown>;
  ...
```

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

