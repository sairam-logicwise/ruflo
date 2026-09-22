/**
 * content-hash.ts — the `contentHash` field's producer (T3).
 *
 * Hashes the record's markdown body only, not the frontmatter — the
 * frontmatter carries `updatedAt`/`contentHash` itself, so hashing it too
 * would make the hash depend on itself. The body is the record's actual
 * content; the hash exists to detect when it drifted from what was last
 * reviewed.
 *
 * Normalizes CRLF to LF before hashing (review-2026-09-21.md, Important
 * 5) — otherwise the identical record hashes differently depending on
 * `core.autocrlf`, and the same file could "drift" on nothing but a
 * checkout setting.
 *
 * @module content-hash
 */

import { createHash } from 'node:crypto';

export function computeContentHash(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
