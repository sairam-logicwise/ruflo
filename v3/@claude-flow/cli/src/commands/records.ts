/**
 * `ruflo record` — T4, agentic SDLC plan (tasks/plan.md). CLI over the
 * typed record substrate T3 built (@claude-flow/docops): requirement,
 * decision, task.
 *
 * Nested under `record` (`ruflo record req|decision|task|validate`) rather
 * than three separate top-level commands as the plan's literal wording
 * suggested ("ruflo req new", "ruflo task new") — `ruflo task` already
 * exists for swarm/agent runtime task orchestration (create/list/status/
 * cancel, agent assignment), a completely different concept from a
 * planning-record Task. Confirmed with the repo owner before naming this;
 * `record` avoids the collision and matches the plan's own file list (one
 * `records.ts`, not three command files).
 *
 * Records are stored one markdown file per record under
 * `docs/{requirements,decisions,tasks}/`, matching @claude-flow/docops's
 * "diff and merge sensibly as files in git" design.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  RECORD_PREFIXES,
  computeContentHash,
  parseRecordFile,
  serializeRecordFile,
  validateRecord,
  validateRecordFile,
  ContentHashMismatchError,
  type RecordKind,
} from '@claude-flow/docops';
import {
  kindDir,
  ensureDir,
  listRecordFiles,
  claimAndWriteRecord,
  slugify,
  findRecordPath,
  splitList,
  resolveBody,
  formatValidationError,
} from './records-io.js';
import decomposeCommand from './decompose.js';

// ---------------------------------------------------------------------------
// Requirement
// ---------------------------------------------------------------------------

const reqNewCommand: Command = {
  name: 'new',
  description: 'Create a new requirement record',
  options: [
    { name: 'title', description: 'Requirement title', type: 'string', required: true },
    { name: 'status', description: 'draft|accepted|superseded', type: 'string', default: 'draft' },
    { name: 'body', description: 'Markdown body text', type: 'string' },
    { name: 'body-file', description: 'Read the markdown body from a file', type: 'string' },
    { name: 'supersedes', description: 'Comma-separated requirement ids this supersedes', type: 'string' },
    { name: 'provenance', description: 'human|agent-inferred', type: 'string', default: 'human' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const title = ctx.flags.title as string | undefined;
    if (!title) {
      output.printError('Missing required --title');
      return { success: false, exitCode: 1 };
    }
    const dir = kindDir(ctx, 'requirement');
    ensureDir(dir);
    const body = resolveBody(ctx, title);
    const now = new Date().toISOString();
    const slug = slugify(title);

    const claimed = claimAndWriteRecord(dir, RECORD_PREFIXES.requirement, slug, (id) => {
      const frontmatter = {
        id,
        title,
        status: (ctx.flags.status as string) ?? 'draft',
        createdAt: now,
        updatedAt: now,
        citations: [],
        contentHash: computeContentHash(body),
        provenance: (ctx.flags.provenance as string) ?? 'human',
        supersedes: splitList(ctx.flags.supersedes),
      };
      const result = validateRecord(frontmatter);
      if (!result.success) return { error: formatValidationError(result.error) };
      return { content: serializeRecordFile(frontmatter, body) };
    });
    if ('error' in claimed) {
      output.printError('Refusing to create requirement', claimed.error);
      return { success: false, exitCode: 1 };
    }
    output.printSuccess(`Created ${claimed.id}: ${claimed.filePath}`);
    return { success: true, data: { id: claimed.id, path: claimed.filePath } };
  },
};

const reqShowCommand: Command = {
  name: 'show',
  description: 'Show a requirement record',
  options: [{ name: 'id', description: 'Requirement id', type: 'string' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] || (ctx.flags.id as string);
    if (!id) {
      output.printError('Usage: ruflo record req show <id>');
      return { success: false, exitCode: 1 };
    }
    return showRecord(ctx, 'requirement', id);
  },
};

const reqListCommand: Command = {
  name: 'list',
  description: 'List requirement records',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => listRecords(ctx, 'requirement'),
};

const reqCommand: Command = {
  name: 'req',
  description: 'Requirement records — the "why" (T3/T4, agentic SDLC plan)',
  subcommands: [reqNewCommand, reqShowCommand, reqListCommand, decomposeCommand],
  action: reqListCommand.action,
};

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

const decisionNewCommand: Command = {
  name: 'new',
  description: 'Create a new decision record',
  options: [
    { name: 'title', description: 'Decision title', type: 'string', required: true },
    { name: 'status', description: 'draft|accepted|superseded', type: 'string', default: 'draft' },
    { name: 'body', description: 'Markdown body text', type: 'string' },
    { name: 'body-file', description: 'Read the markdown body from a file', type: 'string' },
    { name: 'citations', description: 'Comma-separated ids this decision cites (optional)', type: 'string' },
    { name: 'supersedes', description: 'Comma-separated decision ids this supersedes', type: 'string' },
    { name: 'related', description: 'Comma-separated related record ids', type: 'string' },
    { name: 'provenance', description: 'human|agent-inferred', type: 'string', default: 'human' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const title = ctx.flags.title as string | undefined;
    if (!title) {
      output.printError('Missing required --title');
      return { success: false, exitCode: 1 };
    }
    const dir = kindDir(ctx, 'decision');
    ensureDir(dir);
    const body = resolveBody(ctx, title);
    const now = new Date().toISOString();
    const slug = slugify(title);

    const claimed = claimAndWriteRecord(dir, RECORD_PREFIXES.decision, slug, (id) => {
      const frontmatter = {
        id,
        title,
        status: (ctx.flags.status as string) ?? 'draft',
        createdAt: now,
        updatedAt: now,
        citations: splitList(ctx.flags.citations),
        contentHash: computeContentHash(body),
        provenance: (ctx.flags.provenance as string) ?? 'human',
        supersedes: splitList(ctx.flags.supersedes),
        related: splitList(ctx.flags.related),
      };
      const result = validateRecord(frontmatter);
      if (!result.success) return { error: formatValidationError(result.error) };
      return { content: serializeRecordFile(frontmatter, body) };
    });
    if ('error' in claimed) {
      output.printError('Refusing to create decision', claimed.error);
      return { success: false, exitCode: 1 };
    }
    output.printSuccess(`Created ${claimed.id}: ${claimed.filePath}`);
    return { success: true, data: { id: claimed.id, path: claimed.filePath } };
  },
};

const decisionShowCommand: Command = {
  name: 'show',
  description: 'Show a decision record',
  options: [{ name: 'id', description: 'Decision id', type: 'string' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] || (ctx.flags.id as string);
    if (!id) {
      output.printError('Usage: ruflo record decision show <id>');
      return { success: false, exitCode: 1 };
    }
    return showRecord(ctx, 'decision', id);
  },
};

const decisionListCommand: Command = {
  name: 'list',
  description: 'List decision records',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => listRecords(ctx, 'decision'),
};

const decisionCommand: Command = {
  name: 'decision',
  description: 'Decision records — the "how it was decided" (T3/T4, agentic SDLC plan)',
  subcommands: [decisionNewCommand, decisionShowCommand, decisionListCommand],
  action: decisionListCommand.action,
};

// ---------------------------------------------------------------------------
// Task (planning record — distinct from the runtime `ruflo task` command)
// ---------------------------------------------------------------------------

const taskNewCommand: Command = {
  name: 'new',
  description: 'Create a new task record',
  options: [
    { name: 'title', description: 'Task title', type: 'string', required: true },
    // Not `required: true` — that triggers the parser's generic "Required
    // option missing" refusal before this command's own action runs,
    // pre-empting the more useful citation-contract message below.
    { name: 'citations', description: 'Comma-separated ids — must include at least one requirement or decision', type: 'string' },
    { name: 'priority', description: 'p0|p1|p2', type: 'string', default: 'p2' },
    { name: 'status', description: 'drafted|specified|implementing|verifying|done|blocked (T15 state machine)', type: 'string', default: 'drafted' },
    { name: 'depends-on', description: 'Comma-separated task ids that must complete first', type: 'string' },
    { name: 'body', description: 'Markdown body text', type: 'string' },
    { name: 'body-file', description: 'Read the markdown body from a file', type: 'string' },
    { name: 'provenance', description: 'human|agent-inferred', type: 'string', default: 'human' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const title = ctx.flags.title as string | undefined;
    if (!title) {
      output.printError('Missing required --title');
      return { success: false, exitCode: 1 };
    }
    const citations = splitList(ctx.flags.citations);
    // The citation contract (plan.md Task 3/4): refuse before writing
    // anything, naming exactly what's missing.
    if (citations.length === 0) {
      output.printError(
        'Refusing to create a task with no citations',
        'A task must cite at least one requirement or decision. Pass --citations REQ-001[,DEC-002,...]',
      );
      return { success: false, exitCode: 1 };
    }

    const dir = kindDir(ctx, 'task');
    ensureDir(dir);
    const body = resolveBody(ctx, title);
    const now = new Date().toISOString();
    const slug = slugify(title);

    const claimed = claimAndWriteRecord(dir, RECORD_PREFIXES.task, slug, (id) => {
      const frontmatter = {
        id,
        title,
        status: (ctx.flags.status as string) ?? 'drafted',
        priority: (ctx.flags.priority as string) ?? 'p2',
        createdAt: now,
        updatedAt: now,
        citations,
        dependsOn: splitList(ctx.flags['depends-on'] ?? ctx.flags.dependsOn),
        contentHash: computeContentHash(body),
        provenance: (ctx.flags.provenance as string) ?? 'human',
      };
      const result = validateRecord(frontmatter);
      if (!result.success) return { error: formatValidationError(result.error) };
      return { content: serializeRecordFile(frontmatter, body) };
    });
    if ('error' in claimed) {
      output.printError('Refusing to create task', claimed.error);
      return { success: false, exitCode: 1 };
    }
    output.printSuccess(`Created ${claimed.id}: ${claimed.filePath}`);
    return { success: true, data: { id: claimed.id, path: claimed.filePath } };
  },
};

const taskShowCommand: Command = {
  name: 'show',
  description: 'Show a task record',
  options: [{ name: 'id', description: 'Task record id', type: 'string' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const id = ctx.args[0] || (ctx.flags.id as string);
    if (!id) {
      output.printError('Usage: ruflo record task show <id>');
      return { success: false, exitCode: 1 };
    }
    return showRecord(ctx, 'task', id);
  },
};

const taskListCommand: Command = {
  name: 'list',
  description: 'List task records',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => listRecords(ctx, 'task'),
};

const recordTaskCommand: Command = {
  name: 'task',
  description: 'Task records — the "what work" (T3/T4, agentic SDLC plan). Not to be confused with `ruflo task`, the swarm/agent runtime task command.',
  subcommands: [taskNewCommand, taskShowCommand, taskListCommand],
  action: taskListCommand.action,
};

// ---------------------------------------------------------------------------
// Shared show/list implementations
// ---------------------------------------------------------------------------

async function showRecord(ctx: CommandContext, kind: RecordKind, id: string): Promise<CommandResult> {
  const dir = kindDir(ctx, kind);
  const filePath = findRecordPath(dir, id);
  if (!filePath) {
    output.printError(`No ${kind} found matching id "${id}" in ${dir}`);
    return { success: false, exitCode: 1 };
  }
  const raw = readFileSync(filePath, 'utf8');
  const { frontmatter, body, parseError } = parseRecordFile(raw);

  output.writeln(output.bold(filePath));
  if (parseError) {
    output.printWarning(`This record's frontmatter is not valid YAML: ${parseError.message}`);
    return { success: true, data: { path: filePath, frontmatter, valid: false } };
  }

  // Pass body too (not just frontmatter) so this also catches content-hash
  // drift (review-2026-09-21.md, Important 4) — a hand-edited body whose
  // contentHash was never updated.
  const result = validateRecord(frontmatter, body);
  output.printJson(frontmatter);
  output.writeln('');
  output.writeln(body.trim());
  if (!result.success) {
    output.printWarning(`This record does not currently validate: ${formatValidationError(result.error)}`);
  }
  return { success: true, data: { path: filePath, frontmatter, valid: result.success } };
}

async function listRecords(ctx: CommandContext, kind: RecordKind): Promise<CommandResult> {
  const dir = kindDir(ctx, kind);
  const files = listRecordFiles(dir);
  if (files.length === 0) {
    output.writeln(`No ${kind} records found in ${dir}`);
    return { success: true, data: { count: 0, records: [] } };
  }
  const records = files.map((f) => {
    const raw = readFileSync(join(dir, f), 'utf8');
    const { frontmatter, parseError } = parseRecordFile(raw);
    if (parseError) {
      return { id: '?', status: 'INVALID', title: `${f}: not valid YAML — run \`ruflo record validate\`` };
    }
    return {
      id: String(frontmatter.id ?? '?'),
      status: String(frontmatter.status ?? '?'),
      title: String(frontmatter.title ?? '?'),
    };
  });
  output.printTable({
    columns: [
      { key: 'id', header: 'ID' },
      { key: 'status', header: 'Status' },
      { key: 'title', header: 'Title' },
    ],
    data: records,
  });
  return { success: true, data: { count: records.length, records } };
}

// ---------------------------------------------------------------------------
// validate — the whole record set
// ---------------------------------------------------------------------------

const validateCommand: Command = {
  name: 'validate',
  description: 'Validate every requirement, decision, and task record against its schema',
  options: [
    {
      name: 'fix',
      type: 'boolean',
      description: 'Recompute and rewrite contentHash for records that fail ONLY a hash mismatch (e.g. after a hand edit). Does not touch records with other schema violations.',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fix = !!ctx.flags.fix;
    const kinds: RecordKind[] = ['requirement', 'decision', 'task'];
    let total = 0;
    const failures: Array<{ path: string; error: string }> = [];
    const fixed: string[] = [];

    for (const kind of kinds) {
      const dir = kindDir(ctx, kind);
      for (const f of listRecordFiles(dir)) {
        total++;
        const filePath = join(dir, f);
        const raw = readFileSync(filePath, 'utf8');
        const result = validateRecordFile(raw);
        if (result.success) continue;

        // B3, review-2026-09-22.md: the hash gate (Important 4) made a hand-
        // edited body permanently unfixable from the CLI — only a manual
        // SHA-256 recompute could repair it. --fix closes that gap, but only
        // for a PURE hash mismatch: a genuine schema violation (bad status,
        // missing citations, ...) is a real content problem, not a stale
        // hash, and auto-"fixing" it would mean silently rewriting the
        // author's data to make a validator happy — never do that.
        if (fix && result.error instanceof ContentHashMismatchError) {
          const { frontmatter, body } = parseRecordFile(raw);
          frontmatter.contentHash = computeContentHash(body);
          const rewritten = serializeRecordFile(frontmatter, body);
          const revalidated = validateRecordFile(rewritten);
          if (revalidated.success) {
            writeFileSync(filePath, rewritten, 'utf8');
            fixed.push(filePath);
            continue;
          }
          // Rehashing alone didn't make it valid — something else is also
          // wrong; fall through and report the (re-checked) failure.
          failures.push({ path: filePath, error: formatValidationError(revalidated.error) });
          continue;
        }

        failures.push({ path: filePath, error: formatValidationError(result.error) });
      }
    }

    if (fixed.length > 0) {
      output.printSuccess(`Rehashed ${fixed.length} record(s):`);
      for (const p of fixed) output.writeln(`  ${p}`);
    }

    if (failures.length > 0) {
      output.printError(`${failures.length}/${total} record(s) failed validation`);
      for (const f of failures) {
        output.writeln(`  ${f.path}`);
        output.writeln(`    ${f.error}`);
      }
      return { success: false, exitCode: 1, data: { total, invalid: failures.length, failures, fixed } };
    }

    output.printSuccess(`All ${total} record(s) valid.`);
    return { success: true, data: { total, invalid: 0, fixed } };
  },
};

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

export const recordCommand: Command = {
  name: 'record',
  description: 'Typed record substrate — requirement, decision, task (T3/T4, agentic SDLC plan)',
  subcommands: [reqCommand, decisionCommand, recordTaskCommand, validateCommand],
  examples: [
    { command: 'ruflo record req new --title "Quote a feature before building it"', description: 'Create a requirement' },
    { command: 'ruflo record task new --title "Fix pricing bugs" --citations REQ-001 --priority p1', description: 'Create a task citing a requirement' },
    { command: 'ruflo record req list', description: 'List all requirements' },
    { command: 'ruflo record validate', description: 'Validate every record against its schema' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Usage: ruflo record <req|decision|task|validate> ...');
    return { success: true };
  },
};

export default recordCommand;
