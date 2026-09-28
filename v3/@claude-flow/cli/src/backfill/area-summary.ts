/**
 * area-summary.ts — the mechanical backfill pass (T23, agentic SDLC plan,
 * tasks/plan.md). Derives structure, dependencies, entry points, and test
 * presence for one area of the codebase, from the Graphify code graph
 * alone. No model calls, no token cost — Graphify's own extraction is
 * already $0 (AST-only, no LLM), so this is free to re-run whenever the
 * graph refreshes. Grounding the inferred pass that follows (T24) in real
 * structure, rather than a model guessing it, is the whole point.
 *
 * Backfill runs one area at a time (decision D1), never as a wholesale
 * pass over the ~3,667-file repo — this module's own contract reflects
 * that: it always takes one area path prefix, never "the whole repo".
 *
 * @module backfill/area-summary
 */

import { readFileSync, existsSync } from 'node:fs';

interface GraphNode {
  id: string;
  label?: string;
  file_type?: string;
  source_file?: string;
}

interface GraphLink {
  relation?: string;
  source: string;
  target: string;
  source_file?: string;
}

interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
  built_at_commit?: string;
}

export interface AreaSummary {
  /** The path prefix this summary covers, e.g. "v3/@claude-flow/cli/src/ruvector/". */
  area: string;
  /** The commit the underlying graph was built from — re-running against the same graph.json always reproduces the same summary. */
  builtAtCommit: string | null;
  /** Real code files within the area (excluding test files). */
  modules: string[];
  /** Test files that live inside the area itself. */
  testFiles: string[];
  /** Real files OUTSIDE the area that files inside it import from. */
  dependencies: string[];
  /** Files inside the area that code OUTSIDE the area imports or calls into — the area's real boundary. */
  entryPoints: string[];
  /** Non-test modules with at least one test file (anywhere in the repo) referencing them. */
  testedModules: string[];
  /** Non-test modules with no detected test coverage. */
  untestedModules: string[];
}

const IMPORT_RELATIONS = new Set(['imports', 'imports_from']);
const REFERENCE_RELATIONS = new Set(['imports', 'imports_from', 'calls']);
const TEST_FILE_PATTERN = /__tests__|\.test\.|\.spec\./;

function loadGraph(graphPath: string): Graph {
  if (!existsSync(graphPath)) {
    throw new Error(`no graph found at ${graphPath} — run \`/graphify\` or the graph-refresh workflow first`);
  }
  return JSON.parse(readFileSync(graphPath, 'utf8')) as Graph;
}

function inArea(sourceFile: string | undefined, area: string): boolean {
  return !!sourceFile && sourceFile.startsWith(area);
}

/**
 * Summarizes one area of the codebase from the Graphify graph. Pure
 * function of the graph data — same graph in, same summary out, always
 * (the reproducibility acceptance criterion).
 */
export function summarizeArea(area: string, graphPath: string): AreaSummary {
  const graph = loadGraph(graphPath);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  const codeFilesInArea = new Set<string>();
  for (const node of graph.nodes) {
    if (node.file_type === 'code' && inArea(node.source_file, area)) {
      codeFilesInArea.add(node.source_file!);
    }
  }

  const testFiles = new Set<string>();
  const modules = new Set<string>();
  for (const file of codeFilesInArea) {
    if (TEST_FILE_PATTERN.test(file)) testFiles.add(file);
    else modules.add(file);
  }

  const dependencies = new Set<string>();
  const entryPoints = new Set<string>();
  const testedModules = new Set<string>();

  for (const link of graph.links) {
    if (!link.relation) continue;
    const linkFile = link.source_file;
    const targetNode = nodesById.get(link.target);
    const targetFile = targetNode?.source_file;
    if (!linkFile || !targetFile) continue;

    // Dependencies: an import written INSIDE the area, reaching OUTSIDE it.
    if (IMPORT_RELATIONS.has(link.relation) && inArea(linkFile, area) && !inArea(targetFile, area)) {
      dependencies.add(targetFile);
    }

    // Entry points: a reference written OUTSIDE the area, reaching INSIDE it — the boundary the outside world actually uses.
    if (REFERENCE_RELATIONS.has(link.relation) && !inArea(linkFile, area) && inArea(targetFile, area) && modules.has(targetFile)) {
      entryPoints.add(targetFile);
    }

    // Test coverage: a reference written by a test file (anywhere), reaching a module inside the area.
    if (REFERENCE_RELATIONS.has(link.relation) && TEST_FILE_PATTERN.test(linkFile) && modules.has(targetFile)) {
      testedModules.add(targetFile);
    }
  }

  const untestedModules = new Set([...modules].filter((m) => !testedModules.has(m)));

  return {
    area,
    builtAtCommit: graph.built_at_commit ?? null,
    modules: [...modules].sort(),
    testFiles: [...testFiles].sort(),
    dependencies: [...dependencies].sort(),
    entryPoints: [...entryPoints].sort(),
    testedModules: [...testedModules].sort(),
    untestedModules: [...untestedModules].sort(),
  };
}
