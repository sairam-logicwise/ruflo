/**
 * `ruflo record req decompose` — T6, agentic SDLC plan (tasks/plan.md).
 *
 * Takes a requirement record and proposes task records, each citing the
 * requirement, grounded in the Graphify code graph so it can't invent
 * modules that don't exist. A quote is a rollup over task records, so
 * nothing can be estimated (T10/T11) until a requirement has been
 * decomposed — this is also the step that makes a quote explainable: when
 * a stakeholder asks why a feature costs what it costs, the answer is the
 * task list this produces, not an opaque number.
 *
 * Calls a real LLM (via `callAnthropicMessages`, the same primitive
 * `agent_execute` uses — no swarm agent-store coupling needed for a single
 * one-shot call). That costs real money, so this is DRY-RUN BY DEFAULT:
 * without `--yes`, proposals are printed as JSON and nothing is written.
 * `--yes` writes them as task records. `--from-file` skips the LLM call
 * entirely and takes a (possibly hand-edited) proposals JSON instead —
 * the acceptance criterion "output is reviewable and editable before it
 * is committed" is this dry-run-then-edit-then-`--yes --from-file` loop.
 *
 * @module commands/decompose
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { parseRecordFile, computeContentHash, validateRecord, serializeRecordFile, RECORD_PREFIXES } from '@claude-flow/docops';
import { kindDir, findRecordPath, claimAndWriteRecord, slugify, ensureDir, formatValidationError } from './records-io.js';
import { groundInGraph, extractFeatures } from '../ruvector/estimator/features.js';
import { callAnthropicMessages, type AnthropicCallResult } from '../mcp-tools/agent-execute-core.js';

export const MIN_TASKS = 3;
export const MAX_TASKS = 15;

export interface TaskProposalDoneCriteria {
  testLayers: string[];
  coverageThreshold?: number;
}

export interface TaskProposal {
  title: string;
  body: string;
  /** Files this task touches — must be a subset of the grounding list; anything else is dropped, not trusted. */
  files: string[];
  /**
   * T18: which test layers apply and (optionally) a coverage bar. Left
   * unset by the model/--from-file, a sensible default is inferred at
   * decomposition time (see inferDoneCriteria) — never a global default,
   * always this specific task's own bar (plan.md Task 18's whole point).
   * Set explicitly here (by the model, or by a human editing a dry-run's
   * JSON before --from-file --yes) to override the inferred default.
   */
  doneCriteria?: TaskProposalDoneCriteria;
}

/**
 * T18: infers a sensible default doneCriteria for a proposal that doesn't
 * already have one — reuses T9's extractFeatures() (the same test-layer
 * detection T10's estimator will use), so decomposition and estimation
 * agree about what a task needs, the same reasoning T9 itself gives for
 * reusing the router's complexity score. No default coverageThreshold —
 * inventing one would be exactly the kind of unfounded number this repo
 * has repeatedly avoided elsewhere; a human sets one explicitly if they
 * want one.
 */
export function inferDoneCriteria(title: string, body: string, opts: { repoRoot?: string; graphPath?: string } = {}): TaskProposalDoneCriteria {
  const features = extractFeatures({ title }, body, opts);
  return { testLayers: features.testLayers };
}

export function buildDecomposePrompt(
  requirementId: string,
  title: string,
  body: string,
  groundingFiles: string[],
): { system: string; user: string } {
  const system =
    'You decompose a software requirement into small, independently completable ' +
    'implementation tasks for a coding team. Respond with ONLY a JSON array — no ' +
    'prose, no markdown code fences, no explanation before or after it.';

  const groundingBlock = groundingFiles.length > 0
    ? `Files that may be relevant, found in the real codebase graph:\n${groundingFiles.map((f) => `- ${f}`).join('\n')}\n\n` +
      `Only put paths from this exact list in "files". If a task is genuinely new code with no existing file to touch, leave "files" empty — never invent a path.`
    : `No strongly relevant existing files were found in the codebase graph for this requirement. Leave "files" empty on every task rather than inventing paths.`;

  const user =
    `Requirement ${requirementId}: ${title}\n\n${body}\n\n${groundingBlock}\n\n` +
    `Propose between ${MIN_TASKS} and ${MAX_TASKS} tasks. Respond with a JSON array; each element exactly:\n` +
    `{"title": string, "body": string, "files": string[]}\n` +
    `Nothing else in the response.`;

  return { system, user };
}

/** Parses the model's raw response into proposals, or an error naming what was wrong with it. */
export function parseProposals(raw: string): { proposals: TaskProposal[] } | { error: string } {
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: `response was not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!Array.isArray(parsed)) return { error: 'response was not a JSON array' };
  if (parsed.length < MIN_TASKS || parsed.length > MAX_TASKS) {
    return { error: `expected ${MIN_TASKS}-${MAX_TASKS} tasks, got ${parsed.length}` };
  }

  const proposals: TaskProposal[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (typeof item !== 'object' || item === null) return { error: `item ${i} is not an object` };
    const obj = item as Record<string, unknown>;
    if (typeof obj.title !== 'string' || !obj.title.trim()) return { error: `item ${i} is missing a non-empty title` };
    if (typeof obj.body !== 'string' || !obj.body.trim()) return { error: `item ${i} is missing a non-empty body` };
    const files = Array.isArray(obj.files) ? obj.files.filter((f): f is string => typeof f === 'string') : [];

    let doneCriteria: TaskProposalDoneCriteria | undefined;
    if (obj.doneCriteria && typeof obj.doneCriteria === 'object') {
      const dc = obj.doneCriteria as Record<string, unknown>;
      const testLayers = Array.isArray(dc.testLayers) ? dc.testLayers.filter((l): l is string => typeof l === 'string') : [];
      const coverageThreshold = typeof dc.coverageThreshold === 'number' ? dc.coverageThreshold : undefined;
      doneCriteria = { testLayers, ...(coverageThreshold != null ? { coverageThreshold } : {}) };
    }

    proposals.push({ title: obj.title, body: obj.body, files, ...(doneCriteria ? { doneCriteria } : {}) });
  }
  return { proposals };
}

/**
 * Drops any file the model referenced that isn't in the real grounding
 * list. Acceptance criterion: "tasks reference real files or modules from
 * the graph" — a hallucinated path is silently dropped, never written into
 * a record as if it were grounded.
 */
export function groundProposals(proposals: TaskProposal[], groundingFiles: string[]): TaskProposal[] {
  const known = new Set(groundingFiles);
  return proposals.map((p) => ({ ...p, files: p.files.filter((f) => known.has(f)) }));
}

function writeProposalsAsTasks(
  ctx: CommandContext,
  requirementId: string,
  proposals: TaskProposal[],
): { created: Array<{ id: string; filePath: string }>; failed: Array<{ title: string; error: string }> } {
  const dir = kindDir(ctx, 'task');
  ensureDir(dir);
  const now = new Date().toISOString();
  const created: Array<{ id: string; filePath: string }> = [];
  const failed: Array<{ title: string; error: string }> = [];

  for (const proposal of proposals) {
    const body = proposal.files.length > 0
      ? `${proposal.body.trim()}\n\nFiles likely touched:\n${proposal.files.map((f) => `- ${f}`).join('\n')}\n`
      : `${proposal.body.trim()}\n`;
    const slug = slugify(proposal.title);
    const claimed = claimAndWriteRecord(dir, RECORD_PREFIXES.task, slug, (id) => {
      const frontmatter = {
        id,
        title: proposal.title,
        status: 'drafted',
        priority: 'p2',
        createdAt: now,
        updatedAt: now,
        citations: [requirementId],
        dependsOn: [],
        doneCriteria: proposal.doneCriteria,
        contentHash: computeContentHash(body),
        provenance: 'agent-inferred',
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

const decomposeCommand: Command = {
  name: 'decompose',
  description: 'Decompose a requirement into task records, grounded in the code graph (T6, agentic SDLC plan)',
  options: [
    { name: 'yes', description: 'Actually write the proposed tasks (default: dry-run, prints proposals only)', type: 'boolean', default: false },
    { name: 'from-file', description: 'Read proposals from this JSON file instead of calling the LLM — for reviewing/editing a prior dry-run before committing it', type: 'string' },
    { name: 'model', description: 'Anthropic model id to use for decomposition', type: 'string' },
    { name: 'max-tokens', description: 'Max output tokens for the decomposition call', type: 'number', default: 4096 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] || (ctx.flags.id as string);
    if (!id) {
      output.printError('Usage: ruflo record req decompose <id> [--yes] [--from-file <path>]');
      return { success: false, exitCode: 1 };
    }

    const reqDir = kindDir(ctx, 'requirement');
    const reqPath = findRecordPath(reqDir, id);
    if (!reqPath) {
      output.printError(`No requirement found matching id "${id}" in ${reqDir}`);
      return { success: false, exitCode: 1 };
    }
    const { frontmatter, body: reqBody, parseError } = parseRecordFile(readFileSync(reqPath, 'utf8'));
    if (parseError) {
      output.printError(`${reqPath} is not valid YAML frontmatter`, parseError.message);
      return { success: false, exitCode: 1 };
    }
    const title = String(frontmatter.title ?? '');

    // Grounding is computed from the requirement's own text and re-applied
    // regardless of where proposals came from — --from-file is meant for a
    // human-reviewed/edited proposals file, but a hand-edit can still typo
    // a path, and "tasks reference real files... from the graph" is an
    // acceptance criterion for the output, not just a guard against the LLM
    // specifically.
    const graphPath = join(ctx.cwd, 'graphify-out', 'graph.json');
    const groundingFiles = groundInGraph(`${title}\n${reqBody}`, graphPath);

    // The CLI's flag parser normalizes a kebab-case flag to camelCase, but
    // records-io.ts's own resolveBody() defensively checks both forms for
    // the same reason — verified directly: --from-file arrived here as
    // ctx.flags.fromFile, not ctx.flags['from-file'], via the real compiled
    // binary (a unit test constructing ctx by hand never caught this).
    const fromFile = (ctx.flags.fromFile as string | undefined) ?? (ctx.flags['from-file'] as string | undefined);
    let proposals: TaskProposal[];

    if (fromFile) {
      const path = isAbsolute(fromFile) ? fromFile : join(ctx.cwd, fromFile);
      const parsedFile = parseProposals(readFileSync(path, 'utf8'));
      if ('error' in parsedFile) {
        output.printError(`${path} does not contain valid proposals`, parsedFile.error);
        return { success: false, exitCode: 1 };
      }
      proposals = groundProposals(parsedFile.proposals, groundingFiles);
    } else {
      const { system, user } = buildDecomposePrompt(id, title, reqBody, groundingFiles);

      const result: AnthropicCallResult = await callAnthropicMessages({
        prompt: user,
        systemPrompt: system,
        model: ctx.flags.model as string | undefined,
        maxTokens: (ctx.flags.maxTokens as number | undefined) ?? (ctx.flags['max-tokens'] as number | undefined) ?? 4096,
      });
      if (!result.success || !result.output) {
        output.printError('Decomposition call failed', result.error ?? 'no output returned');
        return { success: false, exitCode: 1 };
      }

      const parsedResponse = parseProposals(result.output);
      if ('error' in parsedResponse) {
        output.printError('Model response could not be parsed as task proposals', parsedResponse.error);
        output.writeln(result.output);
        return { success: false, exitCode: 1 };
      }
      proposals = groundProposals(parsedResponse.proposals, groundingFiles);
      if (result.usage) {
        output.printInfo(`decompose call: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens`);
      }
    }

    // T18: fill in a sensible default doneCriteria for any proposal that
    // doesn't already have one (from the model, or a hand-edited
    // --from-file) — applied uniformly regardless of source, same
    // reasoning as grounding above.
    proposals = proposals.map((p) =>
      p.doneCriteria ? p : { ...p, doneCriteria: inferDoneCriteria(p.title, p.body, { repoRoot: ctx.cwd, graphPath }) },
    );

    if (!ctx.flags.yes) {
      output.printInfo(`${proposals.length} task proposal(s) for ${id} — dry run, nothing written. Re-run with --yes to create them, or save this output, edit it, and pass --from-file <path> --yes.`);
      output.printJson(proposals);
      return { success: true, data: { dryRun: true, proposals } };
    }

    const { created, failed } = writeProposalsAsTasks(ctx, id, proposals);
    for (const c of created) output.printSuccess(`Created ${c.id}: ${c.filePath}`);
    for (const f of failed) output.printError(`Refusing to create task "${f.title}"`, f.error);

    if (created.length === 0) {
      return { success: false, exitCode: 1, data: { created, failed } };
    }
    return { success: true, data: { created, failed } };
  },
};

export default decomposeCommand;
