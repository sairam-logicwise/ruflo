/**
 * records-io.ts — storage helpers shared by `records.ts` (T4) and
 * `decompose.ts` (T6): resolving a record kind's directory, id-race-safe
 * writing, id lookup, slugging, and validation-error formatting.
 *
 * Split out of records.ts so decompose.ts can reuse these without a
 * circular import (decompose.ts needs records.ts's writing primitives;
 * records.ts would need decompose.ts's Command to wire in the `decompose`
 * subcommand — this module has no dependency on either, so both can import
 * it cleanly).
 *
 * @module commands/records-io
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { CommandContext } from '../types.js';
import type { RecordKind } from '@claude-flow/docops';

const KIND_DIR: Record<RecordKind, string> = {
  requirement: 'requirements',
  decision: 'decisions',
  task: 'tasks',
};

export function kindDir(ctx: CommandContext, kind: RecordKind): string {
  return join(ctx.cwd, 'docs', KIND_DIR[kind]);
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function listRecordFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

/** Next `<PREFIX>-<NNN>` id, scanning existing filenames for the current max. */
function nextId(dir: string, prefix: string): string {
  const re = new RegExp(`^${prefix}-(\\d+)`);
  let max = 0;
  for (const f of listRecordFiles(dir)) {
    const m = f.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

const MAX_ID_CLAIM_ATTEMPTS = 20;

/**
 * Claim the next id and write a new record file, retrying on a lost race
 * (review-2026-09-21.md, Important 10): `nextId()` reads the directory,
 * then a plain `writeFileSync` would clobber — two agents creating
 * requirements in parallel (a documented workflow for this CLI) could
 * compute the same id, and the second would silently destroy the first's
 * file. `{ flag: 'wx' }` (O_EXCL) makes a same-id collision throw EEXIST
 * instead of overwriting; on that, recompute the id against the now-
 * current directory listing and try again.
 *
 * `buildContent(id)` receives the CANDIDATE id — the caller needs it to
 * build the frontmatter (the `id` field itself) — and returns the
 * serialized file content, or a `{ error }` to refuse the write entirely
 * (a content problem, not an id collision — not worth retrying).
 */
export function claimAndWriteRecord(
  dir: string,
  prefix: string,
  slug: string,
  buildContent: (id: string) => { content: string } | { error: string },
): { id: string; filePath: string } | { error: string } {
  for (let attempt = 0; attempt < MAX_ID_CLAIM_ATTEMPTS; attempt++) {
    const id = nextId(dir, prefix);
    const built = buildContent(id);
    if ('error' in built) return built;

    const filePath = join(dir, `${id}-${slug}.md`);
    try {
      writeFileSync(filePath, built.content, { encoding: 'utf8', flag: 'wx' });
      return { id, filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue; // lost the race — retry with a fresh id
      throw err;
    }
  }
  return { error: `could not claim a new ${prefix}- id after ${MAX_ID_CLAIM_ATTEMPTS} attempts — too much concurrent contention` };
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'untitled';
}

export function findRecordPath(dir: string, id: string): string | undefined {
  const match = listRecordFiles(dir).find((f) => f === `${id}.md` || f.startsWith(`${id}-`));
  return match ? join(dir, match) : undefined;
}

export function splitList(value: unknown): string[] {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Duck-typed: works for a ZodError without importing zod's type into this package. */
export function formatValidationError(error: Error): string {
  const issues = (error as { issues?: Array<{ path: Array<string | number>; message: string }> }).issues;
  if (Array.isArray(issues)) {
    return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  }
  return error.message;
}

/**
 * `--body` inline, else `--body-file` on disk, else a bare heading.
 *
 * Strips leading blank lines (matching serializeRecordFile's own trim)
 * before returning — new problem 2, review-2026-09-22.md: contentHash was
 * computed from this body BEFORE serializeRecordFile silently trimmed it
 * for the file it actually wrote, so a --body-file starting with a blank
 * line failed its own hash check the moment it was created. Trimming here,
 * once, keeps every caller's `computeContentHash(body)` and
 * `serializeRecordFile(frontmatter, body)` looking at identical content.
 */
export function resolveBody(ctx: CommandContext, fallbackTitle: string): string {
  const inline = (ctx.flags.body as string | undefined);
  if (inline) return (inline.endsWith('\n') ? inline : `${inline}\n`).replace(/^\n+/, '');
  const bodyFileFlag = (ctx.flags.bodyFile as string | undefined) ?? (ctx.flags['body-file'] as string | undefined);
  if (bodyFileFlag) {
    const path = isAbsolute(bodyFileFlag) ? bodyFileFlag : join(ctx.cwd, bodyFileFlag);
    return readFileSync(path, 'utf8').replace(/^\n+/, '');
  }
  return `# ${fallbackTitle}\n`;
}
