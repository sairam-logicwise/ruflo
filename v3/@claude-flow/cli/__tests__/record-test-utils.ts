/**
 * Review #3, Important 5: `computeContentHash` now covers the whole
 * frontmatter, not just the body — so a test that directly string-patches
 * a record's raw frontmatter (simulating a hand-edit or skipping straight
 * to a target status, bypassing the real state-machine writers) leaves a
 * stale `contentHash` behind unless it recomputes one afterward. Every
 * test file that does this calls `restampHash(raw)` as the last step
 * before `writeFileSync`, the same way the real writers finalize the hash
 * as their last step (records-io.ts's `finalizeContentHash`).
 */
import { parseRecordFile, serializeRecordFile, computeContentHash } from '@claude-flow/docops';

export function restampHash(raw: string): string {
  const { frontmatter, body } = parseRecordFile(raw);
  return serializeRecordFile({ ...frontmatter, contentHash: computeContentHash(frontmatter, body) }, body);
}
