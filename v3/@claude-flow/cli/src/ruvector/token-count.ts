/**
 * token-count.ts — real BPE token counting, replacing `length / 4` guesses.
 *
 * T12 (agentic SDLC plan) — every token count downstream of this module used
 * to be `text.length / 4`, which is roughly right for English prose and
 * materially wrong for code (the thing we're actually estimating). This
 * wraps `gpt-tokenizer`'s cl100k_base encoding, the standard stand-in for
 * Claude token counts in the absence of a public Anthropic JS tokenizer —
 * close enough for cost estimation and routing, not billing-exact.
 *
 * @module token-count
 */

// The bare `gpt-tokenizer` entry point's default encoding is o200k_base, not
// cl100k_base — verified directly (a mixed code/Unicode string counts 14
// tokens under the default import and o200k_base, 16 under cl100k_base).
// Import the encoding explicitly so this stays cl100k_base regardless of
// what the package's default changes to, and so a minor bump can't
// silently move every quote this produces. The subpath import also avoids
// pulling in the full package (~29MB across all encodings) for one.
import { encode } from 'gpt-tokenizer/encoding/cl100k_base';

/** Count tokens in `text` using a real BPE tokenizer (cl100k_base). */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}
