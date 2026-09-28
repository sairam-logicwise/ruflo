/**
 * T22 (agentic SDLC plan) — `ruflo record workflow-docs`. All three
 * targets (CLAUDE.md, AGENTS.md, the Cursor rules file) must describe the
 * identical workflow — verified here by literally comparing the
 * generated section's content across all three, not just eyeballing it.
 * Existing, real file content must survive untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';
import { AGENTIC_SDLC_SECTION_START, AGENTIC_SDLC_SECTION_END } from '../src/docs/agentic-sdlc-workflow.js';

function sub(cmd: Command, ...path: string[]): Command {
  let current = cmd;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`no subcommand "${name}" under "${current.name}"`);
    current = next;
  }
  return current;
}

function extractSection(content: string): string {
  const start = content.indexOf(AGENTIC_SDLC_SECTION_START);
  const end = content.indexOf(AGENTIC_SDLC_SECTION_END);
  return content.slice(start + AGENTIC_SDLC_SECTION_START.length, end).trim();
}

describe('ruflo record workflow-docs', () => {
  let tmp: string;
  let ctx: CommandContext;
  let recordCommand: Command;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'workflow-docs-'));
    ctx = { args: [], flags: { _: [] }, cwd: tmp, interactive: false };
    ({ recordCommand } = await import('../src/commands/records.js'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('creates all three targets fresh when none exist', async () => {
    const result = await sub(recordCommand, 'workflow-docs').action!(ctx);
    expect(result?.success).toBe(true);
    expect(existsSync(join(tmp, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(tmp, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(tmp, '.cursor', 'rules', 'agentic-sdlc.mdc'))).toBe(true);
  });

  it('all three targets contain the identical workflow section — the "no drift" property', async () => {
    await sub(recordCommand, 'workflow-docs').action!(ctx);
    const claude = extractSection(readFileSync(join(tmp, 'CLAUDE.md'), 'utf8'));
    const agents = extractSection(readFileSync(join(tmp, 'AGENTS.md'), 'utf8'));
    const cursor = extractSection(readFileSync(join(tmp, '.cursor', 'rules', 'agentic-sdlc.mdc'), 'utf8'));
    expect(claude.length).toBeGreaterThan(100);
    expect(claude).toBe(agents);
    expect(agents).toBe(cursor);
  });

  it('the Cursor rules file has valid frontmatter', async () => {
    await sub(recordCommand, 'workflow-docs').action!(ctx);
    const content = readFileSync(join(tmp, '.cursor', 'rules', 'agentic-sdlc.mdc'), 'utf8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toContain('alwaysApply: true');
  });

  it('never touches real, pre-existing, unrelated content in CLAUDE.md or AGENTS.md', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), '# Real project instructions\n\nSomething load-bearing and unrelated.\n');
    writeFileSync(join(tmp, 'AGENTS.md'), '# Codex Agent Guide\n\nA completely different, real, pre-existing document.\n');

    await sub(recordCommand, 'workflow-docs').action!(ctx);

    const claude = readFileSync(join(tmp, 'CLAUDE.md'), 'utf8');
    const agents = readFileSync(join(tmp, 'AGENTS.md'), 'utf8');
    expect(claude).toContain('Something load-bearing and unrelated.');
    expect(agents).toContain('A completely different, real, pre-existing document.');
    expect(claude).toContain(AGENTIC_SDLC_SECTION_START);
    expect(agents).toContain(AGENTIC_SDLC_SECTION_START);
  });

  it('is idempotent — running twice never duplicates the section', async () => {
    await sub(recordCommand, 'workflow-docs').action!(ctx);
    await sub(recordCommand, 'workflow-docs').action!(ctx);

    for (const file of ['CLAUDE.md', 'AGENTS.md', join('.cursor', 'rules', 'agentic-sdlc.mdc')]) {
      const content = readFileSync(join(tmp, file), 'utf8');
      const occurrences = content.split(AGENTIC_SDLC_SECTION_START).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('reports created vs updated correctly across two runs', async () => {
    const first = await sub(recordCommand, 'workflow-docs').action!(ctx);
    const firstData = first?.data as { written: string[]; updated: string[] };
    expect(firstData.written).toHaveLength(3);
    expect(firstData.updated).toHaveLength(0);

    const second = await sub(recordCommand, 'workflow-docs').action!(ctx);
    const secondData = second?.data as { written: string[]; updated: string[] };
    expect(secondData.updated).toHaveLength(3);
    expect(secondData.written).toHaveLength(0);
  });
});
