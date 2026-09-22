/**
 * `ruflo record workflow-docs` — T22, agentic SDLC plan (tasks/plan.md).
 * Writes/updates the SAME agentic-sdlc workflow section into `CLAUDE.md`,
 * `AGENTS.md`, and a new Cursor rules file — all three sourced from
 * `agentic-sdlc-workflow.ts`, so they cannot drift apart (the task's own
 * rationale). Safe to run against real, existing, hand-maintained files:
 * `upsertMarkedSection` only ever touches its own marker-delimited
 * section, never anything else in the file.
 *
 * Deliberately a standalone command rather than a deep hook into the
 * existing `ruflo init`/`CodexInitializer` pipeline — confirmed with the
 * user first (see agentic-sdlc-workflow.ts's own header comment). "`init`
 * emits them" (the task's literal wording) is satisfied in spirit: this
 * is the one discoverable command that emits them, without risking a
 * large, unrelated 1700-line command file that already has several
 * distinct init code paths of its own.
 *
 * @module commands/workflow-docs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { agenticSdlcWorkflowMarkdown, AGENTIC_SDLC_SECTION_START, AGENTIC_SDLC_SECTION_END } from '../docs/agentic-sdlc-workflow.js';
import { upsertMarkedSection } from '../docs/upsert-section.js';

const CURSOR_RULE_PATH = ['.cursor', 'rules', 'agentic-sdlc.mdc'];
const CURSOR_FRONTMATTER = [
  '---',
  'description: Tool-neutral agentic SDLC (ruflo record / ruflo run) — read before making a code change in this repo.',
  'alwaysApply: true',
  '---',
  '',
].join('\n');

const workflowDocsCommand: Command = {
  name: 'workflow-docs',
  description: 'Write/update the agentic-sdlc workflow section in CLAUDE.md, AGENTS.md, and a new Cursor rules file (T22) — one shared source, so the targets cannot drift.',
  options: [],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const body = agenticSdlcWorkflowMarkdown();
    const written: string[] = [];
    const updated: string[] = [];

    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const filePath = join(ctx.cwd, name);
      const existed = existsSync(filePath);
      const before = existed ? readFileSync(filePath, 'utf8') : '';
      writeFileSync(filePath, upsertMarkedSection(before, AGENTIC_SDLC_SECTION_START, AGENTIC_SDLC_SECTION_END, body), 'utf8');
      (existed ? updated : written).push(name);
    }

    const cursorPath = join(ctx.cwd, ...CURSOR_RULE_PATH);
    const cursorExisted = existsSync(cursorPath);
    const cursorBefore = cursorExisted ? readFileSync(cursorPath, 'utf8') : CURSOR_FRONTMATTER;
    mkdirSync(dirname(cursorPath), { recursive: true });
    writeFileSync(cursorPath, upsertMarkedSection(cursorBefore, AGENTIC_SDLC_SECTION_START, AGENTIC_SDLC_SECTION_END, body), 'utf8');
    (cursorExisted ? updated : written).push(CURSOR_RULE_PATH.join('/'));

    if (written.length > 0) output.printSuccess(`created: ${written.join(', ')}`);
    if (updated.length > 0) output.printSuccess(`updated: ${updated.join(', ')}`);
    return { success: true, data: { written, updated } };
  },
};

export default workflowDocsCommand;
