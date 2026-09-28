/**
 * T23 (agentic SDLC plan) — mechanical backfill area summary.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeArea } from '../../src/backfill/area-summary.js';

function node(id: string, sourceFile: string, fileType = 'code') {
  return { id, source_file: sourceFile, file_type: fileType, label: id };
}

function link(relation: string, sourceFile: string, source: string, target: string) {
  return { relation, source_file: sourceFile, source, target };
}

function writeGraph(dir: string, graph: unknown): string {
  const path = join(dir, 'graph.json');
  writeFileSync(path, JSON.stringify(graph));
  return path;
}

describe('summarizeArea', () => {
  let dir: string;

  function cleanup() {
    rmSync(dir, { recursive: true, force: true });
  }

  it('throws a clear error when no graph exists at the given path', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    expect(() => summarizeArea('src/foo/', join(dir, 'does-not-exist.json'))).toThrow(/no graph found/);
    cleanup();
  });

  it('lists real code files within the area, excluding files outside it', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    const graphPath = writeGraph(dir, {
      built_at_commit: 'abc123',
      nodes: [
        node('n1', 'src/area/a.ts'),
        node('n2', 'src/area/b.ts'),
        node('n3', 'src/other/c.ts'),
        node('n4', 'src/area/doc.md', 'document'),
      ],
      links: [],
    });
    const summary = summarizeArea('src/area/', graphPath);
    expect(summary.modules).toEqual(['src/area/a.ts', 'src/area/b.ts']);
    expect(summary.builtAtCommit).toBe('abc123');
    cleanup();
  });

  it('separates test files from modules', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    const graphPath = writeGraph(dir, {
      nodes: [
        node('n1', 'src/area/a.ts'),
        node('n2', 'src/area/__tests__/a.test.ts'),
        node('n3', 'src/area/b.spec.ts'),
      ],
      links: [],
    });
    const summary = summarizeArea('src/area/', graphPath);
    expect(summary.modules).toEqual(['src/area/a.ts']);
    expect(summary.testFiles.sort()).toEqual(['src/area/__tests__/a.test.ts', 'src/area/b.spec.ts']);
    cleanup();
  });

  it('derives dependencies: an import written inside the area, resolving outside it', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    const graphPath = writeGraph(dir, {
      nodes: [
        node('n1', 'src/area/a.ts'),
        node('n2', 'src/other/util.ts'),
        node('n3', 'src/area/b.ts'),
      ],
      links: [
        link('imports', 'src/area/a.ts', 'n1', 'n2'), // area -> outside: a real dependency
        link('imports', 'src/area/a.ts', 'n1', 'n3'), // area -> area: not a dependency
      ],
    });
    const summary = summarizeArea('src/area/', graphPath);
    expect(summary.dependencies).toEqual(['src/other/util.ts']);
    cleanup();
  });

  it('derives entry points: a reference written outside the area, resolving into it', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    const graphPath = writeGraph(dir, {
      nodes: [
        node('n1', 'src/other/caller.ts'),
        node('n2', 'src/area/a.ts'),
        node('n3', 'src/area/b.ts'),
      ],
      links: [
        link('imports', 'src/other/caller.ts', 'n1', 'n2'), // outside -> area: an entry point
        link('calls', 'src/area/a.ts', 'n2', 'n3'), // area -> area: not an entry point
      ],
    });
    const summary = summarizeArea('src/area/', graphPath);
    expect(summary.entryPoints).toEqual(['src/area/a.ts']);
    cleanup();
  });

  it('detects test coverage: a test file referencing a module, anywhere in the repo', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    const graphPath = writeGraph(dir, {
      nodes: [
        node('n1', '__tests__/area/a.test.ts'),
        node('n2', 'src/area/a.ts'),
        node('n3', 'src/area/b.ts'),
      ],
      links: [
        link('imports', '__tests__/area/a.test.ts', 'n1', 'n2'),
      ],
    });
    const summary = summarizeArea('src/area/', graphPath);
    expect(summary.testedModules).toEqual(['src/area/a.ts']);
    expect(summary.untestedModules).toEqual(['src/area/b.ts']);
    cleanup();
  });

  it('is reproducible: the same graph produces byte-identical output every time', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    const graphPath = writeGraph(dir, {
      built_at_commit: 'deadbeef',
      nodes: [node('n1', 'src/area/a.ts'), node('n2', 'src/other/dep.ts')],
      links: [link('imports', 'src/area/a.ts', 'n1', 'n2')],
    });
    const first = summarizeArea('src/area/', graphPath);
    const second = summarizeArea('src/area/', graphPath);
    expect(second).toEqual(first);
    cleanup();
  });

  it('reports no dependencies, entry points, or coverage when the area is isolated', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    const graphPath = writeGraph(dir, {
      nodes: [node('n1', 'src/area/a.ts')],
      links: [],
    });
    const summary = summarizeArea('src/area/', graphPath);
    expect(summary.dependencies).toEqual([]);
    expect(summary.entryPoints).toEqual([]);
    expect(summary.testedModules).toEqual([]);
    expect(summary.untestedModules).toEqual(['src/area/a.ts']);
    cleanup();
  });

  it('handles a link whose target node does not exist without crashing', () => {
    dir = mkdtempSync(join(tmpdir(), 'backfill-'));
    const graphPath = writeGraph(dir, {
      nodes: [node('n1', 'src/area/a.ts')],
      links: [link('imports', 'src/area/a.ts', 'n1', 'missing-node-id')],
    });
    expect(() => summarizeArea('src/area/', graphPath)).not.toThrow();
    cleanup();
  });
});
