/**
 * features.ts — feature extractor for a task record (T9, agentic SDLC
 * plan, tasks/plan.md).
 *
 * Given a task record (frontmatter + markdown body), produces the feature
 * vector T10's estimator will use: complexity score, files likely touched,
 * test layers required, new-code-vs-change, and citation-closure size.
 *
 * Complexity reuses `analyzeTaskComplexity()` from `model-router.ts` — the
 * SAME heuristic the router already uses to pick a model tier, so the
 * estimate and the routing decision agree about how hard a task is
 * (plan.md Task 9 rationale).
 *
 * "Files likely touched" is grounded in the Graphify code graph
 * (`graphify-out/graph.json`, built by `/graphify` or the CI refresh
 * workflow) rather than guessed: task text is reduced to keywords, matched
 * against code-node labels in the graph. No graph on disk — this repo's
 * established graceful-degradation convention (loadOpenRouterAlts,
 * loadEstimatorCorpus) — returns an empty match list, not a throw.
 *
 * Deterministic given the same record and the same on-disk repo state
 * (record tree + graph): no randomness, no network, no LLM call.
 *
 * @module estimator/features
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseRecordFile } from '@claude-flow/docops';
import { analyzeTaskComplexity } from '../model-router.js';

export type TestLayer = 'unit' | 'integration' | 'e2e';

export interface TaskFeatureVector {
  /** 0-1, from analyzeTaskComplexity() — the same score the router uses. */
  complexityScore: number;
  /** Real file paths from the code graph whose label/name matches the task text. */
  filesLikelyTouched: string[];
  /** Test layers the task text or matched files suggest are needed. */
  testLayers: TestLayer[];
  /** True when no existing file was matched — this looks like net-new code. */
  isNewCode: boolean;
  /** Size of the transitive citation/dependency closure, starting from this task's own citations + dependsOn. */
  citationClosureSize: number;
}

export interface ExtractFeaturesOptions {
  /** Repo root for resolving docs/ and the graph. Defaults to process.cwd(). */
  repoRoot?: string;
  /** Override the graph path (mainly for tests). Defaults to <repoRoot>/graphify-out/graph.json. */
  graphPath?: string;
}

interface GraphNode {
  label?: string;
  norm_label?: string;
  source_file?: string;
  file_type?: string;
}

interface Graph {
  nodes: GraphNode[];
}

// Keyed by resolved graph path — a test using a different path gets its own
// cache entry rather than colliding with another test or the real graph.
const graphCache = new Map<string, Graph | null>();

function loadGraph(graphPath: string): Graph | null {
  if (graphCache.has(graphPath)) return graphCache.get(graphPath)!;
  let graph: Graph | null = null;
  try {
    if (existsSync(graphPath)) {
      graph = JSON.parse(readFileSync(graphPath, 'utf8')) as Graph;
    }
  } catch {
    graph = null; // malformed graph — degrade to "no grounding", don't throw
  }
  graphCache.set(graphPath, graph);
  return graph;
}

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'into', 'have', 'will', 'task', 'file', 'files',
  'when', 'then', 'should', 'must', 'also', 'each', 'which', 'their', 'there',
  'about', 'these', 'those', 'been', 'were', 'they', 'them', 'than',
  // Also excluded on the FILE-name side: common enough in filenames across
  // this codebase that a single hit is noise, not a signal (e.g. "index.ts",
  // "utils.ts", "types.ts" match almost anything).
  'index', 'utils', 'util', 'types', 'type', 'test', 'tests', 'spec', 'src',
  'main', 'core', 'base', 'common', 'helper', 'helpers', 'config',
]);

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)));
}

/** Splits a label into its meaningful name tokens (kebab/snake/camelCase-aware). */
function nameTokens(label: string): Set<string> {
  const spaced = label.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const words = spaced.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)));
}

const MAX_FILES_RETURNED = 15;

/**
 * How many of a file's own meaningful name tokens must appear in the task
 * text for that file to count as "likely touched". A single generic word
 * (e.g. "model" or "router" alone, in a router-heavy codebase) matches far
 * too much to be a useful signal — verified directly: an unweighted
 * substring match against this repo's real graph pulled in 140+ files for
 * a two-sentence task description. Requiring ALL of a short (1-2 token)
 * filename's tokens, or a majority of a longer one's, cuts that noise
 * sharply while still matching a genuinely specific mention like
 * "the model router's pricing" against `model-router.ts`.
 */
function requiredOverlap(tokenCount: number): number {
  if (tokenCount <= 2) return tokenCount;
  return Math.ceil(tokenCount * 0.5);
}

function findFilesLikelyTouched(text: string, graph: Graph | null): string[] {
  if (!graph) return [];
  const keywords = extractKeywords(text);
  if (keywords.size === 0) return [];
  const scoreByFile = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.file_type !== 'code' || !node.source_file) continue;
    const label = node.norm_label ?? node.label ?? '';
    if (!label) continue;
    const tokens = nameTokens(label);
    if (tokens.size === 0) continue;
    let overlap = 0;
    for (const token of tokens) if (keywords.has(token)) overlap++;
    if (overlap >= requiredOverlap(tokens.size)) {
      const prev = scoreByFile.get(node.source_file) ?? 0;
      if (overlap > prev) scoreByFile.set(node.source_file, overlap);
    }
  }
  return [...scoreByFile.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_FILES_RETURNED)
    .map(([file]) => file)
    .sort();
}

/**
 * Grounds arbitrary text (not necessarily a task record) against the
 * Graphify code graph — the same token-overlap matching `extractFeatures`
 * uses for `filesLikelyTouched`. Exported for `decompose.ts` (T6), which
 * needs the same grounding applied to a REQUIREMENT's text, not a task's.
 */
export function groundInGraph(text: string, graphPath: string): string[] {
  return findFilesLikelyTouched(text, loadGraph(graphPath));
}

function findTestLayers(text: string, files: string[]): TestLayer[] {
  const layers = new Set<TestLayer>();
  const lower = text.toLowerCase();
  if (files.some((f) => /__tests__|\.test\.|\.spec\./.test(f))) layers.add('unit');
  if (/\bintegration\b/.test(lower)) layers.add('integration');
  if (/\be2e\b|end-to-end/.test(lower)) layers.add('e2e');
  return [...layers];
}

const KIND_DIR_BY_PREFIX: Record<string, string> = {
  REQ: 'requirements',
  DEC: 'decisions',
  TASK: 'tasks',
};

function findRecordFile(repoRoot: string, id: string): string | undefined {
  const prefix = id.split('-')[0];
  const kindDir = KIND_DIR_BY_PREFIX[prefix];
  if (!kindDir) return undefined;
  const dir = join(repoRoot, 'docs', kindDir);
  if (!existsSync(dir)) return undefined;
  const match = readdirSync(dir).find((f) => f === `${id}.md` || f.startsWith(`${id}-`));
  return match ? join(dir, match) : undefined;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Transitive closure over citations/dependsOn/supersedes/related, starting
 * from `startIds`. Cycle-safe (visited set); a record this repo can't find
 * or can't parse is counted (it was cited) but not expanded further.
 */
function citationClosureSize(repoRoot: string, startIds: string[]): number {
  const visited = new Set<string>();
  const queue = [...startIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const path = findRecordFile(repoRoot, id);
    if (!path) continue;
    try {
      const { frontmatter } = parseRecordFile(readFileSync(path, 'utf8'));
      const related = [
        ...toStringArray(frontmatter.citations),
        ...toStringArray(frontmatter.dependsOn),
        ...toStringArray(frontmatter.supersedes),
        ...toStringArray(frontmatter.related),
      ];
      for (const r of related) if (!visited.has(r)) queue.push(r);
    } catch {
      // Malformed record — already counted as visited; don't expand it.
    }
  }
  return visited.size;
}

/**
 * Extract the T10 estimator's input feature vector from a task record.
 *
 * @param frontmatter the task's parsed frontmatter (title, citations, dependsOn at minimum)
 * @param body the task's markdown body
 */
export function extractFeatures(
  frontmatter: { title: string; citations?: string[]; dependsOn?: string[] },
  body: string,
  opts: ExtractFeaturesOptions = {},
): TaskFeatureVector {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const graphPath = opts.graphPath ?? join(repoRoot, 'graphify-out', 'graph.json');
  const text = `${frontmatter.title}\n${body}`;

  const complexity = analyzeTaskComplexity(text);
  const graph = loadGraph(graphPath);
  const filesLikelyTouched = findFilesLikelyTouched(text, graph);

  return {
    complexityScore: complexity.score,
    filesLikelyTouched,
    testLayers: findTestLayers(text, filesLikelyTouched),
    isNewCode: filesLikelyTouched.length === 0,
    citationClosureSize: citationClosureSize(repoRoot, [
      ...(frontmatter.citations ?? []),
      ...(frontmatter.dependsOn ?? []),
    ]),
  };
}
