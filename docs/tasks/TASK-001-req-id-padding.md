---
id: TASK-001
title: Fix REQ-1 vs REQ-001 zero-padding in citation matching
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.146Z
updatedAt: 2026-09-23T06:20:04.146Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 971
  highTokens: 1457
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 983
  outputTokens: 231
  costUsd: 0.006414
contentHash: d50f515689dc85a2962fc86dec275894ea56af0a299bd1d2b8d521df1239e4a4
provenance: agent-inferred
---

Pilot task for T8 calibration (bug-fix, small).

RecordIdSchema only checks the shape <PREFIX>-<digits>. So "REQ-1" and "REQ-001" are both valid, but distinct, strings. A task citing "REQ-1" will never match a file actually named REQ-001-*.md. Propose a fix: normalize ids to a fixed digit width at lookup time, or document why the current behavior is intentional. Show the code change.

## Model response

RecordIdSchema's regex accepts any digit count. So "REQ-1" and "REQ-001" both pass shape validation as distinct strings. findRecordPath then never matches a citation like "REQ-1" against a file named REQ-001-*.md. I confirmed this by reading records-io.ts's own findRecordPath. nextId() always generates ids zero-padded to 3 digits. The real gap sits on the input side. A hand-typed or LLM-proposed citation can skip the padding. Fix the boundary where citations enter the system, not every lookup site:

```ts
export function normalizeRecordId(id: string): string {
  const m = id.match(/^(REQ|DEC|TASK)-(\d+)$/);
  return m ? `${m[1]}-${m[2].padStart(3, '0')}` : id;
}
```

Apply it to splitList(ctx.flags.citations)'s result in taskNewCommand and decisionNewCommand, before validating or writing. This normalizes a citation once at intake. No future lookup site needs to special-case an unpadded id.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

