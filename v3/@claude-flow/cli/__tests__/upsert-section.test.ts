/**
 * T22 (agentic SDLC plan) — upsertMarkedSection. Pure text transform,
 * tested in isolation before anything touches a real file (CLAUDE.md/
 * AGENTS.md are real, existing, hand-maintained files this session must
 * not risk clobbering — see the module's own header comment).
 */

import { describe, it, expect } from 'vitest';
import { upsertMarkedSection } from '../src/docs/upsert-section.js';

const START = '<!-- START -->';
const END = '<!-- END -->';

describe('upsertMarkedSection', () => {
  it('appends a new section to non-empty content that has no markers yet', () => {
    const result = upsertMarkedSection('# Existing file\n\nSome real content.\n', START, END, 'new body');
    expect(result).toContain('# Existing file');
    expect(result).toContain('Some real content.');
    expect(result).toContain(`${START}\n\nnew body\n\n${END}`);
  });

  it('never touches content before or after an appended section', () => {
    const before = '# Existing file\n\nSome real content that must survive untouched.\n';
    const result = upsertMarkedSection(before, START, END, 'new body');
    expect(result.startsWith(before.trimEnd())).toBe(true);
  });

  it('creates a fresh file when existing content is empty', () => {
    const result = upsertMarkedSection('', START, END, 'new body');
    expect(result).toBe(`${START}\n\nnew body\n\n${END}\n`);
  });

  it('replaces an EXISTING marked section in place, leaving surrounding content untouched', () => {
    const before = `# Title\n\nBefore.\n\n${START}\n\nold body\n\n${END}\n\nAfter.\n`;
    const result = upsertMarkedSection(before, START, END, 'new body');
    expect(result).toContain('Before.');
    expect(result).toContain('After.');
    expect(result).toContain('new body');
    expect(result).not.toContain('old body');
  });

  it('is idempotent — running it twice with the same body produces the same output', () => {
    const once = upsertMarkedSection('# Title\n\nreal content\n', START, END, 'body');
    const twice = upsertMarkedSection(once, START, END, 'body');
    expect(twice).toBe(once);
  });

  it('trims the body before wrapping it in markers', () => {
    const result = upsertMarkedSection('', START, END, '\n\n  body with padding  \n\n');
    expect(result).toBe(`${START}\n\nbody with padding\n\n${END}\n`);
  });
});
