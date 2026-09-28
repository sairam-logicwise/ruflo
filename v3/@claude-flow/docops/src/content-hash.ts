/**
 * content-hash.ts — the `contentHash` field's producer (T3).
 *
 * Review #3, Important 5: used to hash the body only. C1 (verification
 * receipts) closed the DEMONSTRATED forged-`done` exploit, but a
 * body-only hash left every other gate-relevant frontmatter field —
 * `status`, `doneCriteria`, `verification`, `estimate`, `actuals`,
 * `blocked` — outside the integrity check entirely. A forger who
 * recomputes a real body's hash could still hand-edit any of those
 * fields and have the record read as untouched. This closes the class:
 * the hash now covers the WHOLE frontmatter (canonically, so key order
 * never matters) plus the body, with exactly one field excluded —
 * `contentHash` itself, which would make the hash depend on its own
 * output. `updatedAt` is deliberately NOT excluded: every real writer in
 * this codebase finalizes it before computing the hash, in the same
 * write, so a legitimate transition never produces a self-inconsistent
 * record — see `records-io.ts`'s callers.
 *
 * `verification` is ALSO excluded, alongside `contentHash` — not an
 * oversight. `buildVerificationReceipt` (records-io.ts) stamps a receipt
 * with a `contentHash` meant to equal the record's own, so `phase-check`
 * can tell "verified against what's on disk now" from "stale". If
 * `verification` counted toward that hash, the two would be circular (the
 * receipt's hash would need to already know its own value) — and in
 * practice the receipt is built from the PRE-transition frontmatter while
 * the top-level hash is finalized POST-transition (new `status`, etc.), so
 * the two would never match on a real write. Excluding `verification`
 * from the hash entirely sidesteps both problems: the receipt's hash and
 * the record's top-level hash are the same formula over the same
 * (verification-free) fields, so they agree whenever the receipt is
 * genuinely fresh, regardless of transition order. This does not weaken
 * Important 5 for `verification` specifically — a forger can already
 * compute this hash themselves (it is not signed), so nothing here was
 * ever protected against deliberate forgery, only against a stale/
 * careless copy; `phase-check.ts` checks `verification.exitCode` directly
 * for the one tamper that would matter (claiming a failed run passed).
 *
 * Canonicalization sorts object keys at EVERY nesting level, not just
 * the top one — verified directly: `JSON.stringify(obj, sortedKeyArray)`
 * looks like it does this but does not; the array-replacer form only
 * filters/orders each object level against the SAME flat array, so a
 * nested object's own keys (e.g. `doneCriteria.testLayers`) come back
 * empty unless their names happen to also appear in the top-level list.
 * `canonicalize()` below recurses instead, deliberately.
 *
 * Normalizes CRLF to LF before hashing (review-2026-09-21.md, Important
 * 5 — a different Important 5, from an earlier review) — otherwise the
 * identical record hashes differently depending on `core.autocrlf`, and
 * the same file could "drift" on nothing but a checkout setting.
 *
 * @module content-hash
 */

import { createHash } from 'node:crypto';

/** Deep, key-sorted clone — makes two objects with the same data hash identically regardless of property insertion order. Arrays keep their own order (order is real data for an array; it never is for a plain object's keys). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Hashes a record's frontmatter (every field except `contentHash`
 * itself) together with its body. Callers pass their full candidate
 * frontmatter object — a `contentHash` key present on it (stale, or a
 * placeholder) is stripped before hashing, never fed into its own input.
 */
export function computeContentHash(frontmatter: Record<string, unknown>, body: string): string {
  const normalized = body.replace(/\r\n/g, '\n');
  const { contentHash: _currentHash, verification: _verification, ...hashable } = frontmatter;
  const canonicalFrontmatter = JSON.stringify(canonicalize(hashable));
  return createHash('sha256').update(`${canonicalFrontmatter}\u0000${normalized}`, 'utf8').digest('hex');
}
