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
