/**
 * T24 (agentic SDLC plan) — inferred requirement/decision extraction's
 * pure logic: real-evidence gathering, prompt construction, response
 * parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherGrounding, buildInferPrompt, parseRecordProposals } from '../../src/backfill/infer.js';

function node(id: string, sourceFile: string, fileType = 'code') {
  return { id, source_file: sourceFile, file_type: fileType, label: id };
}

function writeGraph(dir: string, graph: unknown): string {
  const path = join(dir, 'graph.json');
  writeFileSync(path, JSON.stringify(graph));
  return path;
}

describe('gatherGrounding', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'infer-grounding-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('reads a real git log for the area from an actual git repo — no mocking', () => {
    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
    mkdirSync(join(repoRoot, 'src', 'area'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'area', 'a.ts'), 'export const a = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-q', '-m', 'add area module'], { cwd: repoRoot });

    const graphPath = writeGraph(repoRoot, { built_at_commit: 'abc', nodes: [node('n1', 'src/area/a.ts')], links: [] });
    const grounding = gatherGrounding(repoRoot, 'src/area/', graphPath);

    expect(grounding.gitLog).toHaveLength(1);
    expect(grounding.gitLog[0]).toMatch(/add area module/);
    expect(grounding.summary.modules).toEqual(['src/area/a.ts']);
  });

  it('degrades gracefully to an empty log — not a throw — when the path has no git history', () => {
    // repoRoot is not a git repo at all here.
    const graphPath = writeGraph(repoRoot, { nodes: [node('n1', 'src/area/a.ts')], links: [] });
    const grounding = gatherGrounding(repoRoot, 'src/area/', graphPath);
    expect(grounding.gitLog).toEqual([]);
  });

  it('reads a real README at the area root when one exists, null when it does not', () => {
    mkdirSync(join(repoRoot, 'src', 'area'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'area', 'README.md'), '# Area docs\n\nWhat this does.\n');
    const graphPath = writeGraph(repoRoot, { nodes: [], links: [] });

    expect(gatherGrounding(repoRoot, 'src/area/', graphPath).readme).toContain('What this does.');
    expect(gatherGrounding(repoRoot, 'src/other/', graphPath).readme).toBeNull();
  });
});

describe('buildInferPrompt', () => {
  it('includes the area, modules, entry points, git log, and readme in the user prompt', () => {
    const { user, system } = buildInferPrompt({
      area: 'src/area/',
      summary: { area: 'src/area/', builtAtCommit: null, modules: ['src/area/a.ts'], testFiles: [], dependencies: ['src/other/b.ts'], entryPoints: ['src/area/a.ts'], testedModules: [], untestedModules: ['src/area/a.ts'] },
      gitLog: ['abc1234 add area module'],
      readme: '# Area docs',
    });
    expect(system).toMatch(/requirement and decision records/);
    expect(user).toContain('src/area/');
    expect(user).toContain('src/area/a.ts');
    expect(user).toContain('abc1234 add area module');
    expect(user).toContain('# Area docs');
  });

  it('names the absence of evidence explicitly rather than leaving it blank', () => {
    const { user } = buildInferPrompt({
      area: 'src/thin/',
      summary: { area: 'src/thin/', builtAtCommit: null, modules: [], testFiles: [], dependencies: [], entryPoints: [], testedModules: [], untestedModules: [] },
      gitLog: [],
      readme: null,
    });
    expect(user).toMatch(/No git history found/);
    expect(user).toMatch(/No README found/);
  });
});

describe('parseRecordProposals', () => {
  function raw(items: unknown[]): string {
    return JSON.stringify(items);
  }

  it('parses a valid array of mixed requirement/decision proposals', () => {
    const result = parseRecordProposals(raw([
      { kind: 'requirement', title: 'Cache API responses', body: 'Users need faster repeat reads.', confidence: 0.7 },
      { kind: 'decision', title: 'Use an LRU cache', body: 'Chosen over a TTL-only cache for bounded memory.', confidence: 0.5 },
    ]));
    expect('proposals' in result).toBe(true);
    if ('proposals' in result) {
      expect(result.proposals).toHaveLength(2);
      expect(result.proposals[0].kind).toBe('requirement');
      expect(result.proposals[1].kind).toBe('decision');
    }
  });

  it('strips a fenced code block before parsing', () => {
    const body = '```json\n' + raw([{ kind: 'requirement', title: 'T', body: 'B', confidence: 0.5 }]) + '\n```';
    const result = parseRecordProposals(body);
    expect('proposals' in result).toBe(true);
  });

  it('rejects an empty array — nothing to propose is a real failure, not zero valid proposals', () => {
    const result = parseRecordProposals(raw([]));
    expect('error' in result).toBe(true);
  });

  it('rejects a non-array response', () => {
    const result = parseRecordProposals(JSON.stringify({ not: 'an array' }));
    expect('error' in result).toBe(true);
  });

  it('rejects an invalid kind', () => {
    const result = parseRecordProposals(raw([{ kind: 'task', title: 'T', body: 'B', confidence: 0.5 }]));
    expect(result).toMatchObject({ error: expect.stringMatching(/invalid "kind"/) });
  });

  it('rejects a missing/empty title or body', () => {
    expect(parseRecordProposals(raw([{ kind: 'requirement', title: '', body: 'B', confidence: 0.5 }]))).toMatchObject({ error: expect.stringMatching(/title/) });
    expect(parseRecordProposals(raw([{ kind: 'requirement', title: 'T', body: '', confidence: 0.5 }]))).toMatchObject({ error: expect.stringMatching(/body/) });
  });

  it('rejects a confidence outside [0,1] or non-numeric', () => {
    expect(parseRecordProposals(raw([{ kind: 'requirement', title: 'T', body: 'B', confidence: 1.5 }]))).toMatchObject({ error: expect.stringMatching(/confidence/) });
    expect(parseRecordProposals(raw([{ kind: 'requirement', title: 'T', body: 'B', confidence: -0.1 }]))).toMatchObject({ error: expect.stringMatching(/confidence/) });
    expect(parseRecordProposals(raw([{ kind: 'requirement', title: 'T', body: 'B', confidence: 'high' }]))).toMatchObject({ error: expect.stringMatching(/confidence/) });
  });

  it('rejects more than the sanity cap of proposals', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ kind: 'requirement', title: `T${i}`, body: 'B', confidence: 0.5 }));
    const result = parseRecordProposals(raw(many));
    expect(result).toMatchObject({ error: expect.stringMatching(/at most/) });
  });
});
