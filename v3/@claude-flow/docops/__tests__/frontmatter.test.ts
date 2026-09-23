/**
 * T3 — frontmatter parsing and kind resolution.
 */

import { describe, it, expect } from 'vitest';
import {
  parseRecordFile,
  serializeRecordFile,
  validateRecord,
  validateRecordFile,
  UnknownRecordKindError,
  ContentHashMismatchError,
  ReadabilityError,
} from '../src/frontmatter.js';
import { computeContentHash } from '../src/content-hash.js';

const now = '2026-09-21T00:00:00.000Z';

function recordFile(frontmatterYaml: string, body = 'Body text.\n'): string {
  return `---\n${frontmatterYaml}---\n\n${body}`;
}

describe('parseRecordFile', () => {
  it('keeps an ISO-8601 datetime scalar a string, not a Date (js-yaml version regression)', () => {
    // js-yaml's DEFAULT_SCHEMA auto-detects an ISO-8601-looking scalar as
    // YAML 1.1's !!timestamp and returns a native Date — silently breaking
    // every createdAt/updatedAt field (RecordIdSchema... no, the *Schema
    // for these fields expects z.string().datetime()). Caught when pinning
    // js-yaml's version exposed that the installed version's default
    // schema did this (review-2026-09-21.md, Important 12). Fixed by using
    // JSON_SCHEMA explicitly rather than relying on version-specific
    // default-schema behavior — this test pins that regardless of which
    // js-yaml version resolves, the field stays a string.
    const raw = recordFile(`createdAt: ${now}\n`);
    const { frontmatter } = parseRecordFile(raw);
    expect(typeof frontmatter.createdAt).toBe('string');
    expect(frontmatter.createdAt).toBe(now);
  });

  it('splits YAML frontmatter from the markdown body', () => {
    const raw = recordFile(
      `id: REQ-001\ntitle: Quote a feature before building it\nstatus: accepted\n`,
      'Why this matters: ...\n',
    );
    const { frontmatter, body } = parseRecordFile(raw);
    expect(frontmatter.id).toBe('REQ-001');
    expect(frontmatter.status).toBe('accepted');
    expect(body.trim()).toBe('Why this matters: ...');
  });
});

describe('validateRecord — kind resolution from id prefix', () => {
  it('resolves REQ- to the requirement schema', () => {
    const hash = computeContentHash('body');
    const result = validateRecord({
      id: 'REQ-001', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
      citations: [], contentHash: hash, provenance: 'human', supersedes: [],
    });
    expect(result.success).toBe(true);
  });

  it('resolves DEC- to the decision schema', () => {
    const hash = computeContentHash('body');
    const result = validateRecord({
      id: 'DEC-001', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
      citations: [], contentHash: hash, provenance: 'human', supersedes: [], related: [],
    });
    expect(result.success).toBe(true);
  });

  it('resolves TASK- to the task schema and enforces its citation contract', () => {
    const hash = computeContentHash('body');
    const result = validateRecord({
      id: 'TASK-001', title: 'x', status: 'drafted', priority: 'p1', createdAt: now, updatedAt: now,
      citations: [], dependsOn: [], contentHash: hash, provenance: 'human',
    });
    expect(result.success).toBe(false); // empty citations — task contract
  });

  it('fails clearly on an unrecognized id prefix rather than guessing a schema', () => {
    const result = validateRecord({ id: 'FOO-001', title: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(UnknownRecordKindError);
    }
  });

  it('fails clearly when id is missing entirely', () => {
    const result = validateRecord({ title: 'no id here' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(UnknownRecordKindError);
    }
  });
});

describe('validateRecordFile — end to end on a real file string', () => {
  it('validates a well-formed task file', () => {
    const hash = computeContentHash('Fix the two disagreeing price tables.\n');
    const raw = recordFile(
      [
        'id: TASK-012',
        'title: Fix inherited pricing bugs',
        'status: drafted',
        'priority: p1',
        `createdAt: ${now}`,
        `updatedAt: ${now}`,
        'citations: [REQ-002]',
        'dependsOn: []',
        `contentHash: ${hash}`,
        'provenance: human',
        '',
      ].join('\n'),
      'Fix the two disagreeing price tables.\n',
    );
    const result = validateRecordFile(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.record.id).toBe('TASK-012');
    }
  });

  it('rejects a task file whose citations field is missing entirely', () => {
    const raw = recordFile(
      [
        'id: TASK-013',
        'title: Orphan task',
        'status: drafted',
        'priority: p2',
        `createdAt: ${now}`,
        `updatedAt: ${now}`,
        `contentHash: ${computeContentHash('x')}`,
        'provenance: human',
        '',
      ].join('\n'),
    );
    const result = validateRecordFile(raw);
    expect(result.success).toBe(false);
  });
});

describe('serializeRecordFile — the write side (T4)', () => {
  it('round-trips: serialize then parse recovers the same frontmatter', () => {
    const frontmatter = {
      id: 'REQ-042',
      title: 'A requirement with a colon: and quotes "like this"',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      citations: [],
      contentHash: computeContentHash('body'),
      provenance: 'human',
      supersedes: [],
    };
    const raw = serializeRecordFile(frontmatter, 'The body.\n');
    const { frontmatter: parsedBack, body } = parseRecordFile(raw);
    expect(parsedBack).toEqual(frontmatter);
    expect(body.trim()).toBe('The body.');
  });

  it('round-trips the body byte-for-byte, not just after trimming', () => {
    // Regression: serializeRecordFile writes "---\n\n" (a blank line after
    // the closing delimiter, the conventional frontmatter separator) but
    // parseRecordFile used to only consume one of those two newlines,
    // leaving a leading "\n" in every parsed body. Invisible until content-
    // hash drift detection (Important 4) started comparing hashes computed
    // from the pre-round-trip body against the post-round-trip one — every
    // record the CLI ever created would have failed its own validation.
    const body = 'Fix the pricing bugs.\n';
    const raw = serializeRecordFile({ id: 'TASK-001', title: 'x' }, body);
    const { body: parsedBody } = parseRecordFile(raw);
    expect(parsedBody).toBe(body);
  });

  it('survives a CRLF-normalised checkout (B2, review-2026-09-22.md)', () => {
    // Simulates core.autocrlf converting every \n to \r\n on checkout — a
    // real Windows scenario, not a synthetic one. Regression: the old
    // FRONTMATTER_PATTERN's `\r?\n+` only consumed the FIRST \r\n of the
    // blank-line separator (`\r?` binds once; `\n+` then can't match the
    // second pair's leading \r), leaving a stray "\r\n" stuck on the front
    // of every parsed body. computeContentHash's own CRLF normalisation
    // (Important 5) can't fix this — the corruption is a literal extra
    // \r\n character the hash was never computed against, not just a line-
    // ending style difference. This hard-blocked commits on Windows for
    // files nobody had touched.
    const body = '# Title\nSome content the contributor wrote.\n';
    const frontmatter = {
      id: 'TASK-100', title: 'CRLF checkout', status: 'drafted', priority: 'p2',
      createdAt: now, updatedAt: now, citations: ['REQ-001'], dependsOn: [],
      contentHash: computeContentHash(body), provenance: 'human',
    };
    const lf = serializeRecordFile(frontmatter, body);
    const crlf = lf.replace(/\n/g, '\r\n');

    const { body: parsedBody } = parseRecordFile(crlf);
    expect(parsedBody).toBe(body.replace(/\n/g, '\r\n'));

    const result = validateRecordFile(crlf);
    expect(result.success).toBe(true);
  });

  it('a serialized record validates successfully', () => {
    // contentHash must match the exact body passed to serializeRecordFile
    // below ('do the thing\n', with the trailing newline) — now that
    // content-hash drift detection is real (Important 4), a mismatched
    // fixture here fails for the right reason, not silently.
    const body = 'do the thing\n';
    const frontmatter = {
      id: 'TASK-099',
      title: 'Round-trip task',
      status: 'drafted',
      priority: 'p2',
      createdAt: now,
      updatedAt: now,
      citations: ['REQ-001'],
      dependsOn: [],
      contentHash: computeContentHash(body),
      provenance: 'human',
    };
    const raw = serializeRecordFile(frontmatter, body);
    const result = validateRecordFile(raw);
    expect(result.success).toBe(true);
  });
});

describe('content-hash drift detection (Important 4, review-2026-09-21.md)', () => {
  it('validateRecord passes when contentHash matches the given body', () => {
    const body = 'The actual body.';
    const result = validateRecord(
      {
        id: 'REQ-001', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
        citations: [], contentHash: computeContentHash(body), provenance: 'human', supersedes: [],
      },
      body,
    );
    expect(result.success).toBe(true);
  });

  it('validateRecord fails when contentHash does not match the given body (stale/fabricated hash)', () => {
    const result = validateRecord(
      {
        id: 'REQ-001', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
        citations: [], contentHash: computeContentHash('the original body'), provenance: 'human', supersedes: [],
      },
      'the body was edited by hand, but contentHash was not updated',
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ContentHashMismatchError);
    }
  });

  it('validateRecord skips hash checking entirely when no body is given (frontmatter-only check)', () => {
    // e.g. at creation time, where the hash was just computed from this
    // exact body — checking it again would be a pure no-op.
    const result = validateRecord({
      id: 'REQ-001', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
      citations: [], contentHash: computeContentHash('anything at all'), provenance: 'human', supersedes: [],
    });
    expect(result.success).toBe(true);
  });

  it('validateRecordFile (the real end-to-end path) catches a hand-edited body with a stale hash', () => {
    const raw = recordFile(
      [
        'id: REQ-002',
        'title: Drifted record',
        'status: draft',
        `createdAt: ${now}`,
        `updatedAt: ${now}`,
        'citations: []',
        `contentHash: ${computeContentHash('the original body')}`,
        'provenance: human',
        'supersedes: []',
        '',
      ].join('\n'),
      'someone hand-edited this body without updating contentHash\n',
    );
    const result = validateRecordFile(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ContentHashMismatchError);
    }
  });
});

describe('readability gate (T21, agentic SDLC plan)', () => {
  it('validateRecord rejects a record whose body fails the readability check, with a useful message', () => {
    const body = 'This might possibly be updated prior to the release and then merged once it is reviewed by someone.';
    const result = validateRecord(
      {
        id: 'REQ-003', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
        citations: [], contentHash: computeContentHash(body), provenance: 'human', supersedes: [],
      },
      body,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ReadabilityError);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  // Review #3, Important 14: a readability failure used to be permanently
  // unfixable-by-appeal — no way to accept a record a human has reviewed
  // and judged a false positive.
  it('readabilityWaived accepts a record that fails readability, and surfaces what was waived', () => {
    const body = 'This might possibly be updated prior to the release and then merged once it is reviewed by someone.';
    const frontmatter = {
      id: 'REQ-003', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
      citations: [], contentHash: computeContentHash(body), provenance: 'human', supersedes: [],
    };

    const rejected = validateRecord(frontmatter, body);
    expect(rejected.success).toBe(false); // unwaived: still rejected, same as before

    const waived = validateRecord({ ...frontmatter, readabilityWaived: true }, body);
    expect(waived.success).toBe(true);
    if (waived.success) {
      expect(waived.waivedIssues).toBeDefined();
      expect(waived.waivedIssues!.length).toBeGreaterThan(0); // the check still ran — waiving doesn't hide that issues were found
    }
  });

  it('validateRecord accepts a well-written body', () => {
    const body = 'This change fixes the pricing bug. It affects only the OpenRouter path.';
    const result = validateRecord(
      {
        id: 'REQ-004', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
        citations: [], contentHash: computeContentHash(body), provenance: 'human', supersedes: [],
      },
      body,
    );
    expect(result.success).toBe(true);
  });

  it('jargon only fails validation when readabilityStrict is true on the record', () => {
    const body = 'Utilize the existing pipeline for this.';
    const base = {
      id: 'REQ-005', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
      citations: [], contentHash: computeContentHash(body), provenance: 'human', supersedes: [],
    };
    expect(validateRecord({ ...base, readabilityStrict: false }, body).success).toBe(true);
    const strict = validateRecord({ ...base, readabilityStrict: true }, body);
    expect(strict.success).toBe(false);
    if (!strict.success) expect(strict.error).toBeInstanceOf(ReadabilityError);
  });

  it('readability is not checked when body is omitted (creation-time frontmatter-only check)', () => {
    const body = 'This might possibly need review prior to merging.';
    const result = validateRecord({
      id: 'REQ-006', title: 'x', status: 'draft', createdAt: now, updatedAt: now,
      citations: [], contentHash: computeContentHash(body), provenance: 'human', supersedes: [],
    });
    expect(result.success).toBe(true);
  });

  it('validateRecordFile (the real end-to-end path) rejects a genuinely bad summary', () => {
    const body = 'The configuration might possibly need updating by the maintainer prior to release and then be merged once approved.';
    const raw = recordFile(
      [
        'id: DEC-002',
        'title: A decision with bad prose',
        'status: draft',
        `createdAt: ${now}`,
        `updatedAt: ${now}`,
        'citations: []',
        `contentHash: ${computeContentHash(body)}`,
        'provenance: human',
        'supersedes: []',
        'related: []',
        '',
      ].join('\n'),
      body,
    );
    const result = validateRecordFile(raw);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeInstanceOf(ReadabilityError);
  });
});
