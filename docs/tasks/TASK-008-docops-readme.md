---
id: TASK-008
title: Write docops/README.md
status: done
priority: p2
createdAt: 2026-09-23T06:20:04.170Z
updatedAt: 2026-09-23T06:20:04.170Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 1554
  highTokens: 2330
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 1667
  outputTokens: 275
  costUsd: 0.009126
  source: proxy
  priceModel: anthropic/claude-sonnet-4-6
contentHash: d7cefc71c183a56c276d448b41b3e900f71b74ff2dbc8981612591398467ebdc
provenance: agent-inferred
---

Pilot task for T8 calibration (docs, medium).

@claude-flow/docops has no README.md. Write one. Say what this package is. It is a typed record substrate for requirement, decision, and task records — see the exports in index.ts for the real API surface. Say why it exists. It vendors and reimplements DocOps, without depending on it — see ATTRIBUTION.md. Add a short usage example using validateRecordFile or parseRecordFile. Keep it concise. This is a README, not a spec.

## Model response

Writing v3/@claude-flow/docops/README.md:

```markdown
# @claude-flow/docops

Typed record substrate for the agentic SDLC: requirement, decision, and task records.
Each record is one markdown file with YAML frontmatter, under docs/{requirements,decisions,tasks}/.

Adapted from [DocOps](https://github.com/logicwind/DocOps) — see ATTRIBUTION.md.
This package vendors DocOps for reference only. It has no runtime dependency and no Go build.
The three record kinds and the citation contract are reimplemented here, natively, in TypeScript.

## What this exports

See src/index.ts for the full surface. It exports RequirementSchema, DecisionSchema, and
TaskSchema (zod schemas); parseRecordFile, serializeRecordFile, validateRecord, and
validateRecordFile (parse and validate a record file); computeContentHash; and the task
lifecycle state machine (attemptTransition, resumeFromBlocked).

## Usage

Call validateRecordFile(rawFileContent) with a record file's raw text.
It returns { success: true, record } on a valid record, or { success: false, error } otherwise.
```

I kept this short. It points at the real API surface in src/index.ts instead of duplicating what the schemas already document inline.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

