/**
 * upsert-section.ts — T22, agentic SDLC plan. Pure text transform: insert
 * or replace a marker-delimited section inside an existing file's content,
 * leaving everything else byte-for-byte untouched. Idempotent — running it
 * twice with the same body produces the same output.
 *
 * Exists specifically so `ruflo record workflow-docs` can safely touch
 * real, existing, hand-maintained files (CLAUDE.md, AGENTS.md) without
 * risking the kind of whole-file overwrite this session hit once already
 * (an unrelated command written to an existing file's path, T19) — this
 * module never sees or replaces anything outside its own markers.
 *
 * @module docs/upsert-section
 */

export function upsertMarkedSection(existing: string, start: string, end: string, body: string): string {
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  const section = `${start}\n\n${body.trim()}\n\n${end}`;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return existing.slice(0, startIdx) + section + existing.slice(endIdx + end.length);
  }

  if (existing.length === 0) return `${section}\n`;
  const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return `${existing}${sep}${section}\n`;
}
