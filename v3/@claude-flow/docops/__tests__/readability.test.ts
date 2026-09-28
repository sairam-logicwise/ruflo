/**
 * T21 (agentic SDLC plan) — ASD-STE100-inspired readability validator.
 */

import { describe, it, expect } from 'vitest';
import { validateReadability } from '../src/validators/readability.js';

describe('validateReadability — sentence length', () => {
  it('passes a short, clear sentence', () => {
    const result = validateReadability('Fix the pricing bug in the router.');
    expect(result.ok).toBe(true);
  });

  it('flags a sentence over the word ceiling, naming the count', () => {
    const long = 'This is a very long sentence that keeps going and going and going with many extra words piled on top of each other well past what a reader can hold in mind at once and keeps adding more clauses.';
    const result = validateReadability(long);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.rule === 'sentence-length');
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/\d+ words/);
  });
});

describe('validateReadability — active voice', () => {
  it('passes an active-voice sentence', () => {
    const result = validateReadability('The router picks the model.');
    expect(result.ok).toBe(true);
  });

  it('flags a passive-voice construction', () => {
    const result = validateReadability('The model is picked by the router.');
    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.rule === 'active-voice')).toBeDefined();
  });

  it('flags an irregular-participle passive too', () => {
    const result = validateReadability('The file was written by the agent.');
    expect(result.issues.some((i) => i.rule === 'active-voice')).toBe(true);
  });

  // Review #3, Important 14: REGULAR_PARTICIPLE used to be /^[a-z]+(ed|en)$/i
  // — any word ending in "en", not just a real past participle. Verified
  // by execution against these exact three sentences.
  it('does not false-positive on ordinary English ending in "en" (Important 14)', () => {
    expect(validateReadability('This is often the case.').ok).toBe(true);
    expect(validateReadability('The port is open.').ok).toBe(true);
    expect(validateReadability('The build is green.').ok).toBe(true);
  });

  it('still flags a real "-en" past-participle passive (the fix narrows the false positives, not the real detections)', () => {
    const result = validateReadability('The build was broken by the change.');
    expect(result.issues.some((i) => i.rule === 'active-voice')).toBe(true);
  });
});

describe('validateReadability — one instruction per sentence', () => {
  it('passes a single instruction', () => {
    const result = validateReadability('Run the tests.');
    expect(result.ok).toBe(true);
  });

  it('flags two instructions joined by "and then"', () => {
    const result = validateReadability('Run the tests and then commit the change.');
    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.rule === 'one-instruction')).toBeDefined();
  });
});

describe('validateReadability — hedging words', () => {
  it('passes a direct, confident statement', () => {
    const result = validateReadability('The estimator returns a range.');
    expect(result.ok).toBe(true);
  });

  it('flags a hedging word, naming which one', () => {
    const result = validateReadability('This might possibly work in most cases.');
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.rule === 'hedging');
    expect(issue?.message).toContain('might');
  });
});

describe('validateReadability — jargon (strict mode only)', () => {
  it('does not flag jargon in default mode', () => {
    const result = validateReadability('Utilize the existing pipeline.');
    expect(result.issues.find((i) => i.rule === 'jargon')).toBeUndefined();
  });

  it('flags jargon in strict mode, naming the approved substitute', () => {
    const result = validateReadability('Utilize the existing pipeline.', { strict: true });
    const issue = result.issues.find((i) => i.rule === 'jargon');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('use');
  });

  it('flags a multi-word jargon phrase in strict mode', () => {
    const result = validateReadability('Do this prior to merging.', { strict: true });
    expect(result.issues.some((i) => i.rule === 'jargon' && i.message.includes('before'))).toBe(true);
  });
});

describe('validateReadability — a deliberately dense summary fails with a useful message', () => {
  it('flags multiple real problems in one bad paragraph', () => {
    // Long, passive, hedging, multiple instructions, jargon — a genuinely
    // bad record summary, the kind requirement 4 exists to catch.
    const dense =
      'It is believed that the configuration might possibly need to be updated by the maintainer prior to the release, ' +
      'and this could somewhat affect downstream consumers who are utilizing the older interface, so the change should ' +
      'probably be reviewed and then merged once approved.';
    const result = validateReadability(dense, { strict: true });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(1);
    // Every issue names the offending sentence, not just an abstract rule id.
    for (const issue of result.issues) expect(issue.sentence.length).toBeGreaterThan(0);
  });
});

describe('validateReadability — a normal, well-written record body is unaffected', () => {
  it('passes real prose from this repo\'s own commit-quality writing', () => {
    const body =
      'This CLI resolves the alts asset relative to the module, not the process. ' +
      'It checks two candidate paths and falls back to the tier label when neither exists. ' +
      'Callers can override the path with an environment variable.';
    const result = validateReadability(body);
    expect(result.ok).toBe(true);
  });
});

describe('validateReadability — fenced code blocks are not prose (real bug found validating T8\'s calibration task records)', () => {
  it('does not fold a large code block into one giant sentence-length violation', () => {
    const body =
      'Add a size cap before parsing.\n\n' +
      '```ts\n' +
      'const MAX_FRONTMATTER_BYTES = 64 * 1024;\n' +
      'if (match[1].length > MAX_FRONTMATTER_BYTES) {\n' +
      '  return { frontmatter: {}, body, parseError: new Error("frontmatter block exceeds the byte limit and parsing is refused") };\n' +
      '}\n' +
      'const frontmatter = parseYaml(match[1], { schema: JSON_SCHEMA }) ?? {};\n' +
      '```\n\n' +
      'That is the whole change.';
    const result = validateReadability(body);
    expect(result.ok).toBe(true);
  });

  it('still checks the real prose surrounding a code block, code is exempt, not the whole body', () => {
    const body =
      'It is believed that the configuration might possibly need to be updated by the maintainer prior to the release ' +
      'and this could somewhat affect downstream consumers who are utilizing the older interface so it should probably be reviewed.\n\n' +
      '```ts\n' +
      'const x = 1;\n' +
      '```\n';
    const result = validateReadability(body);
    expect(result.ok).toBe(false);
  });

  it('does not flag a hedging word or jargon term written inside a code comment', () => {
    const body = '```ts\n// maybe utilize a cache here prior to release\nconst x = 1;\n```\n';
    const result = validateReadability(body, { strict: true });
    expect(result.ok).toBe(true);
  });

  it('an unterminated code fence does not crash the check (degrades safely, does not hang)', () => {
    const body = 'Some prose.\n\n```ts\nconst x = 1;\n';
    expect(() => validateReadability(body)).not.toThrow();
  });
});

describe('validateReadability — a paragraph break is always a sentence boundary (real bug found validating T8\'s calibration task records)', () => {
  it('does not merge a new paragraph into the previous one just because it starts lowercase', () => {
    // A record body legitimately opens a new paragraph with a code identifier
    // (groundInGraph, reqNewCommand, ...) — lowercase by convention, not a
    // grammar mistake. Collapsing the blank line before splitting used to
    // glue this onto the prior sentence into one long pseudo-sentence.
    const body = 'This is the setup sentence, ending cleanly.\n\ngroundInGraph() lives in features.ts for others to reuse.';
    const result = validateReadability(body);
    expect(result.ok).toBe(true);
  });

  it('still flags a genuinely long sentence within a single paragraph', () => {
    const body =
      'It is believed that the configuration might possibly need to be updated by the maintainer prior to the release ' +
      'and this could somewhat affect downstream consumers who are utilizing the older interface so it should probably be reviewed.';
    const result = validateReadability(body);
    expect(result.ok).toBe(false);
  });
});
