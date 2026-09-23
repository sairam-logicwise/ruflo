---
id: TASK-016
title: Check computeContentHash's CRLF normalization for a lone-CR edge case
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.201Z
updatedAt: 2026-09-23T06:20:04.201Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 472
  highTokens: 708
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 417
  outputTokens: 173
  costUsd: 0.003846
contentHash: 90a3cb485bef5c4cbcf358c36507d02f88e2d2edb47cf718adc23b5e7b34fcc5
provenance: agent-inferred
---

Pilot task for T8 calibration (bug-fix, small).

computeContentHash normalizes \r\n to \n before hashing (fixing CRLF-checkout instability). Old Mac-style line endings (a lone \r with no following \n) are rare but not impossible in a hand-edited file. Does the current normalization handle a lone \r correctly, or would it leave a stray \r in the hashed content? Show a concrete before/after example and, if it's a real gap, propose the fix.

## Model response

Confirmed a real gap. body.replace(/\r\n/g, '\n') only matches a CR immediately followed by an LF. A lone \r (old Mac-style, no following \n) does not match this pattern. It stays in the normalized string, and gets hashed with the stray \r byte still present. Example: "line1\rline2" (lone CR) normalizes to itself, unchanged, and hashes including the \r byte. "line1\nline2" (plain LF, logically the same two lines) hashes differently. The hash stays deterministic for a given file — no drift on its own. But two files a human would call equivalent, line-endings-wise, hash differently. Fix — catch both cases in one pass:

```ts
const normalized = body.replace(/\r\n|\r/g, '\n');
```

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

