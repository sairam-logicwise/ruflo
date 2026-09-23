/**
 * readability.ts — an ASD-STE100-inspired plain-English check on a
 * record's body (T21, agentic SDLC plan, tasks/plan.md). The point of
 * requirement 4 is review speed: if a reviewer has to decode the AI's
 * prose, the workflow has just moved the bottleneck, not removed it.
 *
 * Five checks, in two modes:
 *   - Default (structural, always on): sentence length, active voice, one
 *     instruction per sentence, hedging words.
 *   - Strict (opt-in per record — see BaseRecordShape.readabilityStrict):
 *     adds a controlled-vocabulary check, for records meant to leave the
 *     team.
 *
 * These are heuristics over plain text, not a real NLP pipeline — there is
 * no part-of-speech tagger or sentence parser here, deliberately: a
 * dependency that size for a lint-style check on markdown prose would be
 * a bad trade, and the ASD-STE100 standard itself is designed to be
 * checkable by a human without special tooling. Each check's own doc
 * comment names its specific blind spots rather than pretending to
 * grammatical precision it doesn't have — a validator that's wrong loudly
 * (a documented heuristic) is safer than one that's wrong quietly (an
 * unstated one).
 *
 * Scope: this operates on whatever text it's given — a record's markdown
 * body, "summaries and reports" per the acceptance criteria. It is wired
 * into `validateRecord`, which only ever sees record bodies; it is never
 * called on code or commit messages, because docops has no reason to ever
 * read either.
 *
 * @module validators/readability
 */

export type ReadabilityRule = 'sentence-length' | 'active-voice' | 'one-instruction' | 'hedging' | 'jargon';

export interface ReadabilityIssue {
  rule: ReadabilityRule;
  /** The specific sentence that triggered this issue — enough context to fix it without re-reading the whole body. */
  sentence: string;
  message: string;
}

export interface ReadabilityResult {
  ok: boolean;
  issues: ReadabilityIssue[];
}

export interface ReadabilityOptions {
  strict?: boolean;
}

// ASD-STE100 guidance is commonly cited as ~20 words for an instruction,
// a little more tolerated for a description. One practical ceiling for
// both, rather than trying to classify sentence type first.
const MAX_SENTENCE_WORDS = 25;

/**
 * A fenced code block (```...```, any info string) has no reason to
 * contain sentence-ending punctuation the way prose does, so
 * `splitSentences` was folding an entire code sample into one giant
 * pseudo-"sentence" — real bug, found by validating a real record body
 * that shows a code change alongside its explanation (T8's calibration
 * pilot task records): a ~30-line TypeScript snippet inside a body
 * produced a spurious 176-231-word sentence-length violation, and
 * occasionally a false active-voice hit off a code comment. Stripped
 * before ANY check runs, not just sentence-length — a hedging word or
 * jargon term inside a code comment isn't prose either. This module's own
 * stated scope is "summaries and reports," never code (see the module
 * doc comment); a fenced block embedded in an otherwise-prose body is
 * still code, and now correctly exempt.
 */
const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;

function stripCodeBlocks(text: string): string {
  return text.replace(FENCED_CODE_BLOCK, '');
}

/**
 * Splits body text into sentences. A period/question mark/exclamation
 * point followed by whitespace and a capital letter, digit, or opening
 * quote/paren is treated as a sentence boundary — a pragmatic heuristic,
 * not a real sentence-boundary detector (it will misfire on things like
 * "e.g. X" or a markdown list item ending mid-abbreviation). Good enough
 * for prose in a record body; not attempting decimal-number or
 * abbreviation disambiguation.
 *
 * A blank line (paragraph break) is ALSO always a boundary, checked before
 * the punctuation-based split, on its own, unconditionally — a second real
 * bug this same T8 exercise found: the old code collapsed all whitespace
 * (including blank lines) into single spaces before ever looking for a
 * boundary, so a new paragraph that happens to start with a lowercase code
 * identifier (`groundInGraph() is exported...`, `reqNewCommand and
 * decisionNewCommand are...`) never counted as starting a new sentence —
 * the capital-letter check has no way to know it, and the previous
 * paragraph's final sentence silently absorbed the whole next paragraph.
 * A paragraph break is already a strong, unambiguous structural signal on
 * its own; it does not need the capitalization heuristic to confirm it.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .flatMap((paragraph) =>
      paragraph
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/),
    )
    .map((s) => s.trim())
    .filter(Boolean);
}

function checkSentenceLength(sentence: string): ReadabilityIssue | null {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length > MAX_SENTENCE_WORDS) {
    return {
      rule: 'sentence-length',
      sentence,
      message: `${words.length} words — ASD-STE100-style guidance is at most ${MAX_SENTENCE_WORDS} per sentence; split it up`,
    };
  }
  return null;
}

// Lightweight passive-voice heuristic: a form of "be" immediately followed
// by what looks like a past participle (regular -ed/-en, or a short list
// of common irregulars). Real passive-voice detection needs a real POS
// tagger; this catches the textbook cases ("was written by", "is
// configured") and will both miss real passives that don't fit the
// pattern and flag some false positives (e.g. "is fixed" used as an
// adjective, "is finished" as a state) — a documented limitation, not a
// claim of grammatical precision.
const BE_FORM = /^(is|are|was|were|be|been|being)$/i;
const REGULAR_PARTICIPLE = /^[a-z]+(ed|en)$/i;
const IRREGULAR_PARTICIPLES = new Set([
  'done', 'made', 'seen', 'known', 'shown', 'given', 'taken', 'written',
  'built', 'sent', 'held', 'found', 'lost', 'brought', 'thought', 'bought',
  'run', 'set', 'read', 'put', 'cut', 'chosen', 'grown', 'drawn',
]);

function checkActiveVoice(sentence: string): ReadabilityIssue | null {
  const words = sentence.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    if (!BE_FORM.test(words[i])) continue;
    const next = words[i + 1].replace(/[^a-zA-Z]/g, '');
    if (REGULAR_PARTICIPLE.test(next) || IRREGULAR_PARTICIPLES.has(next.toLowerCase())) {
      return {
        rule: 'active-voice',
        sentence,
        message: `possible passive voice ("${words[i]} ${words[i + 1]}") — prefer active voice and name who does the action`,
      };
    }
  }
  return null;
}

// One instruction per sentence: flags the common "do X and then do Y" /
// "do X; then do Y" pattern joining two imperative clauses. A keyword
// heuristic, not a clause parser — it will miss instructions joined other
// ways and may flag a genuinely single action that happens to contain
// "and then" in a non-sequential sense.
const MULTI_INSTRUCTION_JOINER = /\b(and then|,\s*then|;\s*then)\b/i;

function checkOneInstruction(sentence: string): ReadabilityIssue | null {
  if (MULTI_INSTRUCTION_JOINER.test(sentence)) {
    return {
      rule: 'one-instruction',
      sentence,
      message: 'looks like more than one instruction joined together — split into separate sentences, one action each',
    };
  }
  return null;
}

const HEDGING_WORDS = [
  'might', 'maybe', 'perhaps', 'possibly', 'probably', 'somewhat',
  'fairly', 'relatively', 'seems to', 'appears to', 'sort of', 'kind of',
];

function checkHedging(sentence: string): ReadabilityIssue | null {
  const lower = sentence.toLowerCase();
  const found = HEDGING_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(lower));
  if (found) {
    return {
      rule: 'hedging',
      sentence,
      message: `hedging word "${found}" — say what is true, or say what is unknown and why; not both at once`,
    };
  }
  return null;
}

/**
 * A small, representative sample of ASD-STE100's "not approved" ->
 * "approved" substitutions — NOT the real standard's controlled
 * vocabulary (tens of thousands of entries), which is far outside scope
 * here. Strict-mode only: this is the "controlled vocabulary for
 * artifacts that leave the team" the plan's own description names.
 */
const JARGON_SUBSTITUTIONS: Record<string, string> = {
  utilize: 'use',
  utilizes: 'uses',
  utilizing: 'using',
  'prior to': 'before',
  'in order to': 'to',
  approximately: 'about',
  commence: 'start',
  terminate: 'end',
  facilitate: 'help',
  leverage: 'use',
  'in the event that': 'if',
  aforementioned: 'this',
};

function checkJargon(sentence: string): ReadabilityIssue | null {
  const lower = sentence.toLowerCase();
  for (const [bad, good] of Object.entries(JARGON_SUBSTITUTIONS)) {
    if (new RegExp(`\\b${bad}\\b`).test(lower)) {
      return { rule: 'jargon', sentence, message: `"${bad}" is not an approved term — use "${good}" instead` };
    }
  }
  return null;
}

/** Checks `text` against the structural rules, plus the controlled-vocabulary rule when `opts.strict` is set. */
export function validateReadability(text: string, opts: ReadabilityOptions = {}): ReadabilityResult {
  const issues: ReadabilityIssue[] = [];
  for (const sentence of splitSentences(stripCodeBlocks(text))) {
    for (const check of [checkSentenceLength, checkActiveVoice, checkOneInstruction, checkHedging]) {
      const issue = check(sentence);
      if (issue) issues.push(issue);
    }
    if (opts.strict) {
      const issue = checkJargon(sentence);
      if (issue) issues.push(issue);
    }
  }
  return { ok: issues.length === 0, issues };
}
