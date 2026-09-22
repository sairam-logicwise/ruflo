/**
 * T9 (agentic SDLC plan) — task record feature extractor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFeatures } from '../../../src/ruvector/estimator/features.js';

function graphNode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    label: 'pricing.ts',
    norm_label: 'pricing.ts',
    source_file: 'src/pricing.ts',
    file_type: 'code',
    ...overrides,
  };
}

function writeGraph(dir: string, nodes: unknown[]): string {
  const graphPath = join(dir, 'graph.json');
  writeFileSync(graphPath, JSON.stringify({ nodes }));
  return graphPath;
}

function writeRecord(dir: string, kindDir: string, id: string, frontmatter: Record<string, unknown>): void {
  const recordsDir = join(dir, 'docs', kindDir);
  mkdirSync(recordsDir, { recursive: true });
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  writeFileSync(join(recordsDir, `${id}-x.md`), `---\n${lines.join('\n')}\n---\n\nBody.\n`);
}

describe('extractFeatures', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'features-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns a complexity score from the same heuristic the router uses', () => {
    const graphPath = writeGraph(repoRoot, []);
    const v = extractFeatures({ title: 'Fix pricing bugs' }, 'Simple one-line fix.', { repoRoot, graphPath });
    expect(v.complexityScore).toBeGreaterThanOrEqual(0);
    expect(v.complexityScore).toBeLessThanOrEqual(1);
  });

  it('grounds filesLikelyTouched in the graph — matches real nodes, not guesses', () => {
    const graphPath = writeGraph(repoRoot, [
      graphNode({ label: 'pricing.ts', norm_label: 'pricing.ts', source_file: 'src/pricing.ts' }),
      graphNode({ label: 'unrelated.ts', norm_label: 'unrelated.ts', source_file: 'src/unrelated.ts' }),
    ]);
    const v = extractFeatures({ title: 'Fix the pricing calculation' }, 'Update pricing logic.', { repoRoot, graphPath });
    expect(v.filesLikelyTouched).toEqual(['src/pricing.ts']);
  });

  it('returns no matches (not a guess) when there is no graph on disk', () => {
    const v = extractFeatures({ title: 'Fix pricing bugs' }, 'Body text.', {
      repoRoot,
      graphPath: join(repoRoot, 'does-not-exist.json'),
    });
    expect(v.filesLikelyTouched).toEqual([]);
    expect(v.isNewCode).toBe(true);
  });

  it('does not match a multi-token filename off a single generic word (real bug found in dev, review this before merging)', () => {
    // Verified directly against this repo's real 58k-node graph: an
    // unweighted single-token substring match pulled in 140+ files for a
    // two-sentence task mentioning "model" and "router" separately.
    // model-router.ts needs BOTH tokens present, not just one.
    const graphPath = writeGraph(repoRoot, [
      graphNode({ label: 'model-router.ts', norm_label: 'model-router.ts', source_file: 'src/model-router.ts' }),
    ]);
    const onlyModel = extractFeatures({ title: 'Add a new model' }, 'Nothing about routing.', { repoRoot, graphPath });
    expect(onlyModel.filesLikelyTouched).toEqual([]);

    const both = extractFeatures({ title: 'Fix the model router' }, 'Body.', { repoRoot, graphPath });
    expect(both.filesLikelyTouched).toEqual(['src/model-router.ts']);
  });

  it('caps results at 15, ranked by token-overlap score', () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      graphNode({
        label: `pricing-widget-${i}.ts`,
        norm_label: `pricing-widget-${i}.ts`,
        source_file: `src/pricing-widget-${i}.ts`,
      }),
    );
    const graphPath = writeGraph(repoRoot, nodes);
    const v = extractFeatures({ title: 'Fix the pricing widget' }, 'Body.', { repoRoot, graphPath });
    expect(v.filesLikelyTouched).toHaveLength(15); // 20 equally-scored matches available, capped to 15
  });

  it('ignores non-code nodes when matching files', () => {
    const graphPath = writeGraph(repoRoot, [
      graphNode({ label: 'pricing docs', norm_label: 'pricing docs', source_file: 'docs/pricing.md', file_type: 'doc' }),
    ]);
    const v = extractFeatures({ title: 'Update pricing' }, 'Body.', { repoRoot, graphPath });
    expect(v.filesLikelyTouched).toEqual([]);
  });

  it('isNewCode is false once a file is matched', () => {
    const graphPath = writeGraph(repoRoot, [graphNode()]);
    const v = extractFeatures({ title: 'Fix pricing bugs' }, 'Body.', { repoRoot, graphPath });
    expect(v.isNewCode).toBe(false);
  });

  it('detects unit test layer from a matched test file path', () => {
    const graphPath = writeGraph(repoRoot, [
      graphNode({ label: 'pricing.test.ts', norm_label: 'pricing.test.ts', source_file: '__tests__/pricing.test.ts' }),
    ]);
    const v = extractFeatures({ title: 'Fix pricing bugs' }, 'Body.', { repoRoot, graphPath });
    expect(v.testLayers).toContain('unit');
  });

  it('detects integration/e2e layers from the task text itself', () => {
    const graphPath = writeGraph(repoRoot, []);
    const v = extractFeatures(
      { title: 'Add an integration test' },
      'Also needs an end-to-end check.',
      { repoRoot, graphPath },
    );
    expect(v.testLayers).toContain('integration');
    expect(v.testLayers).toContain('e2e');
  });

  it('computes citationClosureSize over the transitive citations/dependsOn graph', () => {
    writeRecord(repoRoot, 'requirements', 'REQ-001', { id: 'REQ-001', citations: [] });
    writeRecord(repoRoot, 'decisions', 'DEC-001', { id: 'DEC-001', citations: ['REQ-001'] });
    const graphPath = writeGraph(repoRoot, []);

    const v = extractFeatures(
      { title: 'A task', citations: ['DEC-001'], dependsOn: [] },
      'Body.',
      { repoRoot, graphPath },
    );
    // DEC-001 (cited directly) + REQ-001 (DEC-001's own citation) = 2
    expect(v.citationClosureSize).toBe(2);
  });

  it('citationClosureSize does not loop forever on a citation cycle', () => {
    writeRecord(repoRoot, 'decisions', 'DEC-001', { id: 'DEC-001', citations: ['DEC-002'] });
    writeRecord(repoRoot, 'decisions', 'DEC-002', { id: 'DEC-002', citations: ['DEC-001'] });
    const graphPath = writeGraph(repoRoot, []);

    const v = extractFeatures({ title: 'A task', citations: ['DEC-001'] }, 'Body.', { repoRoot, graphPath });
    expect(v.citationClosureSize).toBe(2);
  });

  it('counts a citation to a record that does not exist on disk, without expanding it', () => {
    const graphPath = writeGraph(repoRoot, []);
    const v = extractFeatures({ title: 'A task', citations: ['REQ-999'] }, 'Body.', { repoRoot, graphPath });
    expect(v.citationClosureSize).toBe(1);
  });

  it('is deterministic: the same record and repo state produce the same vector', () => {
    const graphPath = writeGraph(repoRoot, [graphNode()]);
    writeRecord(repoRoot, 'requirements', 'REQ-001', { id: 'REQ-001', citations: [] });
    const record = { title: 'Fix pricing bugs', citations: ['REQ-001'] };

    const v1 = extractFeatures(record, 'Body text.', { repoRoot, graphPath });
    const v2 = extractFeatures(record, 'Body text.', { repoRoot, graphPath });
    expect(v2).toEqual(v1);
  });
});
