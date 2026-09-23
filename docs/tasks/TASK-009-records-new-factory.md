---
id: TASK-009
title: De-duplicate records.ts's three `new` actions with a shared factory
status: done
priority: p1
createdAt: 2026-09-23T06:20:04.174Z
updatedAt: 2026-09-23T06:20:04.174Z
citations:
  - DEC-001
dependsOn: []
estimate:
  lowTokens: 4476
  highTokens: 6714
  confidence: 0.9
doneCriteria:
  testLayers: []
actuals:
  inputTokens: 4910
  outputTokens: 685
  costUsd: 0.025005
contentHash: b357a7f1a6deaa8d49fcaed18293cbe95e25d03e5b667aa1b04df40ec4712e18
provenance: agent-inferred
---

Pilot task for T8 calibration (refactor, large).

reqNewCommand, decisionNewCommand (structurally identical, not shown here), and taskNewCommand each hand-roll the same ~30-line pattern: resolve body, build frontmatter, validate, claimAndWriteRecord. Each uses a different frontmatter literal and different flags. Propose a `makeNewCommand(kind, buildFrontmatter)`-style factory that removes the duplication. Keep each kind's own flags and validation distinct — task's citation-contract pre-check in particular must stay. Show the concrete refactor for reqNewCommand as the worked example.

## Model response

reqNewCommand and decisionNewCommand are structurally identical, about 30 lines each. Both resolve the body, build a frontmatter literal, validate it, and call claimAndWriteRecord. They differ only in the frontmatter literal's extra fields. Worked example, building reqNewCommand from a shared factory:

```ts
function makeNewCommand(
  kind: 'requirement' | 'decision',
  prefix: string,
  extraOptions: CommandOption[],
  buildExtraFields: (ctx: CommandContext) => Record<string, unknown>,
): Command {
  return {
    name: 'new',
    description: `Create a new ${kind} record`,
    options: [
      { name: 'title', description: `${kind} title`, type: 'string', required: true },
      { name: 'status', description: 'draft|accepted|superseded', type: 'string', default: 'draft' },
      { name: 'body', description: 'Markdown body text', type: 'string' },
      { name: 'body-file', description: 'Read the markdown body from a file', type: 'string' },
      ...extraOptions,
      { name: 'provenance', description: 'human|agent-inferred', type: 'string', default: 'human' },
    ],
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      const title = ctx.flags.title as string | undefined;
      if (!title) { output.printError('Missing required --title'); return { success: false, exitCode: 1 }; }
      const dir = kindDir(ctx, kind);
      ensureDir(dir);
      const body = resolveBody(ctx, title);
      const now = new Date().toISOString();
      const claimed = claimAndWriteRecord(dir, prefix, slugify(title), (id) => {
        const frontmatter = {
          id, title, status: (ctx.flags.status as string) ?? 'draft',
          createdAt: now, updatedAt: now,
          contentHash: computeContentHash(body),
          provenance: (ctx.flags.provenance as string) ?? 'human',
          ...buildExtraFields(ctx),
        };
        const result = validateRecord(frontmatter, body);
        if (!result.success) return { error: formatValidationError(result.error) };
        return { content: serializeRecordFile(frontmatter, body) };
      });
      if ('error' in claimed) { output.printError(`Refusing to create ${kind}`, claimed.error); return { success: false, exitCode: 1 }; }
      output.printSuccess(`Created ${claimed.id}: ${claimed.filePath}`);
      return { success: true, data: { id: claimed.id, path: claimed.filePath } };
    },
  };
}

const reqNewCommand = makeNewCommand('requirement', RECORD_PREFIXES.requirement,
  [{ name: 'supersedes', description: 'Comma-separated requirement ids this supersedes', type: 'string' }],
  (ctx) => ({ citations: [], supersedes: splitList(ctx.flags.supersedes) }));
```

taskNewCommand stays hand-rolled, unchanged. Its citation-contract pre-check refuses before any write, with its own message. That check does not fit this factory's shape without complicating it for one caller.

---
_Actuals note: this session's own model did this task directly. No separate API call ran, since this session has no ANTHROPIC_API_KEY. So `inputTokens`/`outputTokens` come from a local tokenizer count on the real prompt and response text. That count is approximate, not an API-metered `usage` object. Cost uses anthropic/claude-sonnet-4-6 as its price. That is the nearest entry in model-prices.ts to this session's real model, which has no dedicated price-table entry yet. This labels every record by the model that actually did the work, never the haiku/sonnet/opus tier this pilot task was originally assigned to._

