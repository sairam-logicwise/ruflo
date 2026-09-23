/**
 * `ruflo backfill` — T23, agentic SDLC plan (tasks/plan.md). CLI surface
 * over the mechanical, zero-cost area summary (`../backfill/area-summary.ts`).
 * Backfill runs one area at a time (decision D1) — this command always
 * takes exactly one area path prefix, never "the whole repo".
 *
 * @module commands/backfill
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { summarizeArea } from '../backfill/area-summary.js';
import { gatherGrounding, buildInferPrompt, parseRecordProposals, type RecordProposal } from '../backfill/infer.js';
import { RECORD_PREFIXES, computeContentHash, serializeRecordFile, validateRecord } from '@claude-flow/docops';
import { kindDir, ensureDir, claimAndWriteRecord, slugify, formatValidationError } from './records-io.js';
import { callAnthropicMessages, type AnthropicCallResult } from '../mcp-tools/agent-execute-core.js';

const backfillSummarizeCommand: Command = {
  name: 'summarize',
  description: 'Summarize one area of the codebase from the Graphify graph — modules, dependencies, entry points, test presence. No model calls, no token cost.',
  options: [
    { name: 'area', description: 'Path prefix to summarize, e.g. v3/@claude-flow/cli/src/ruvector/', type: 'string' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const area = ctx.args[0] || (ctx.flags.area as string);
    if (!area) {
      output.printError('Usage: ruflo backfill summarize <area-path-prefix>');
      return { success: false, exitCode: 1 };
    }
    const graphPath = join(ctx.cwd, 'graphify-out', 'graph.json');
    try {
      const summary = summarizeArea(area, graphPath);
      output.printJson(summary);
      return { success: true, data: summary };
    } catch (err) {
      output.printError('Could not summarize area', err instanceof Error ? err.message : String(err));
      return { success: false, exitCode: 1 };
    }
  },
};

/** Writes proposals as real requirement/decision records — always `status: draft`, `provenance: agent-inferred`, never auto-accepted no matter how high `confidence` is (T24's whole point: a human confirms first). */
function writeProposalsAsRecords(
  ctx: CommandContext,
  proposals: RecordProposal[],
): { created: Array<{ id: string; filePath: string }>; failed: Array<{ title: string; error: string }> } {
  const now = new Date().toISOString();
  const created: Array<{ id: string; filePath: string }> = [];
  const failed: Array<{ title: string; error: string }> = [];

  for (const proposal of proposals) {
    const kind = proposal.kind;
    const dir = kindDir(ctx, kind);
    ensureDir(dir);
    const body = `${proposal.body.trim()}\n`;
    const slug = slugify(proposal.title);
    const claimed = claimAndWriteRecord(dir, RECORD_PREFIXES[kind], slug, (id) => {
      const frontmatter: Record<string, unknown> = {
        id,
        title: proposal.title,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        citations: [],
        contentHash: computeContentHash(body),
        provenance: 'agent-inferred',
        confidence: proposal.confidence,
        supersedes: [],
        ...(kind === 'decision' ? { related: [] } : {}),
      };
      const result = validateRecord(frontmatter, body);
      if (!result.success) return { error: formatValidationError(result.error) };
      return { content: serializeRecordFile(frontmatter, body) };
    });
    if ('error' in claimed) failed.push({ title: proposal.title, error: claimed.error });
    else created.push(claimed);
  }
  return { created, failed };
}

const backfillInferCommand: Command = {
  name: 'infer',
  description: 'Propose requirement and decision records for one area, grounded in its real structure, git history, and docs (T24, agentic SDLC plan) — dry-run by default',
  options: [
    { name: 'yes', description: 'Actually write the proposed records (default: dry-run, prints proposals only)', type: 'boolean', default: false },
    { name: 'from-file', description: 'Read proposals from this JSON file instead of calling the LLM — for reviewing/editing a prior dry-run before committing it', type: 'string' },
    { name: 'model', description: 'Anthropic model id to use for inference', type: 'string' },
    { name: 'max-tokens', description: 'Max output tokens for the inference call', type: 'number', default: 4096 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const area = ctx.args[0] || (ctx.flags.area as string);
    if (!area) {
      output.printError('Usage: ruflo backfill infer <area-path-prefix> [--yes] [--from-file <path>]');
      return { success: false, exitCode: 1 };
    }

    const graphPath = join(ctx.cwd, 'graphify-out', 'graph.json');
    const fromFile = (ctx.flags.fromFile as string | undefined) ?? (ctx.flags['from-file'] as string | undefined);
    let proposals: RecordProposal[];

    if (fromFile) {
      const path = isAbsolute(fromFile) ? fromFile : join(ctx.cwd, fromFile);
      const parsedFile = parseRecordProposals(readFileSync(path, 'utf8'));
      if ('error' in parsedFile) {
        output.printError(`${path} does not contain valid proposals`, parsedFile.error);
        return { success: false, exitCode: 1 };
      }
      proposals = parsedFile.proposals;
    } else {
      let grounding;
      try {
        grounding = gatherGrounding(ctx.cwd, area, graphPath);
      } catch (err) {
        output.printError('Could not gather grounding for area', err instanceof Error ? err.message : String(err));
        return { success: false, exitCode: 1 };
      }
      const { system, user } = buildInferPrompt(grounding);

      const result: AnthropicCallResult = await callAnthropicMessages({
        prompt: user,
        systemPrompt: system,
        model: ctx.flags.model as string | undefined,
        maxTokens: (ctx.flags.maxTokens as number | undefined) ?? (ctx.flags['max-tokens'] as number | undefined) ?? 4096,
      });
      if (!result.success || !result.output) {
        output.printError('Inference call failed', result.error ?? 'no output returned');
        return { success: false, exitCode: 1 };
      }

      const parsedResponse = parseRecordProposals(result.output);
      if ('error' in parsedResponse) {
        output.printError('Model response could not be parsed as record proposals', parsedResponse.error);
        output.writeln(result.output);
        return { success: false, exitCode: 1 };
      }
      proposals = parsedResponse.proposals;
      if (result.usage) {
        output.printInfo(`infer call: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`);
      }
    }

    if (!ctx.flags.yes) {
      output.printInfo(`${proposals.length} proposal(s) for ${area} — dry run, nothing written. Every proposal will be status: draft, provenance: agent-inferred — confirm each with \`ruflo record req|decision confirm <id>\` once reviewed. Re-run with --yes to write them, or save this output, edit it, and pass --from-file <path> --yes.`);
      output.printJson(proposals);
      return { success: true, data: { dryRun: true, proposals } };
    }

    const { created, failed } = writeProposalsAsRecords(ctx, proposals);
    for (const c of created) output.printSuccess(`Created ${c.id}: ${c.filePath}`);
    for (const f of failed) output.printError(`Refusing to create "${f.title}"`, f.error);

    if (created.length === 0) {
      return { success: false, exitCode: 1, data: { created, failed } };
    }
    output.printInfo(`${created.length} record(s) created as drafts — none are authoritative until confirmed (\`ruflo record req|decision confirm <id>\`).`);
    return { success: true, data: { created, failed } };
  },
};

const backfillCommand: Command = {
  name: 'backfill',
  description: 'Mechanical backfill pass over the existing codebase (T23, agentic SDLC plan) — one area at a time, no model calls',
  subcommands: [backfillSummarizeCommand, backfillInferCommand],
  action: backfillSummarizeCommand.action,
};

export default backfillCommand;
