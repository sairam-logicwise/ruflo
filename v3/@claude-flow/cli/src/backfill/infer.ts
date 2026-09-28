/**
 * infer.ts — inferred requirement/decision extraction (T24, agentic SDLC
 * plan, tasks/plan.md). "An agent reads an area's code, git history and
 * existing docs, then proposes requirement and decision records."
 *
 * Grounds every proposal in REAL evidence, not a guess: T23's
 * `summarizeArea()` (structure, dependencies, entry points, test
 * presence — zero-cost, from the Graphify graph), the area's own real
 * `git log`, and a real README if the area has one. "Graphify gives
 * structure, never intent" (this task's own rationale) — this module is
 * the intent-reading pass ON TOP of that structure, never instead of it.
 *
 * Same architecture as decompose.ts (T6) on purpose — one real LLM call
 * (`callAnthropicMessages`), dry-run by default so nothing is written or
 * spent without `--yes`, `--from-file` to review/edit before committing.
 * Every proposal is written `provenance: 'agent-inferred'`, `status:
 * 'draft'`, and carries the model's own stated `confidence` — NEVER
 * `status: 'accepted'` directly, no matter how confident the proposal:
 * "a human confirms before it counts as authoritative" is the whole
 * point of this task, and T16's existing citation-acceptance gate
 * already refuses to let a `draft` record satisfy a phase gate — see
 * `commands/records-io.ts`'s `confirmRecord()` for the promotion step.
 *
 * @module backfill/infer
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { summarizeArea, type AreaSummary } from './area-summary.js';

export interface RecordProposal {
  kind: 'requirement' | 'decision';
  title: string;
  body: string;
  /** 0-1, how much real evidence backed this specific proposal — the model's own honest self-assessment, not a fabricated constant. */
  confidence: number;
}

const MAX_PROPOSALS = 20;

/** Real `git log`, best-effort — a shallow checkout or a repo with no history for this path is not an error, just less evidence (same graceful-degradation convention as loadGraph/loadEstimatorCorpus). */
function gitLogForArea(repoRoot: string, area: string): string[] {
  try {
    const out = execFileSync('git', ['log', '--oneline', '-20', '--', area], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** A real README at the area's own root, if one exists — "existing docs" (this task's own wording), not invented. */
function existingReadme(repoRoot: string, area: string): string | null {
  const path = join(repoRoot, area, 'README.md');
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8').slice(0, 4000); // bounded — this is grounding context, not the whole doc verbatim
  } catch {
    return null;
  }
}

export interface InferGrounding {
  area: string;
  summary: AreaSummary;
  gitLog: string[];
  readme: string | null;
}

/** Gathers every real, mechanical evidence source T24 grounds its proposals in — no model call, $0, same contract as summarizeArea itself. */
export function gatherGrounding(repoRoot: string, area: string, graphPath: string): InferGrounding {
  return {
    area,
    summary: summarizeArea(area, graphPath),
    gitLog: gitLogForArea(repoRoot, area),
    readme: existingReadme(repoRoot, area),
  };
}

export function buildInferPrompt(grounding: InferGrounding): { system: string; user: string } {
  const system =
    'You read real evidence about one area of an existing codebase and propose requirement and ' +
    'decision records that a real engineering team would recognize as re-deriving their own intent — ' +
    'never invented functionality the evidence does not support. A requirement is the "why" (what ' +
    'capability this area gives the system and who needs it); a decision is the "how it was decided" ' +
    '(a real architectural choice visible in the structure or history, and a real alternative it ' +
    'reasonably passed over). Respond with ONLY a JSON array — no prose, no markdown code fences, no ' +
    'explanation before or after it.';

  const { summary, gitLog, readme, area } = grounding;
  const parts = [
    `Area: ${area}`,
    `Modules (${summary.modules.length}): ${summary.modules.slice(0, 30).join(', ') || '(none)'}`,
    `Entry points (what outside code actually calls into this area): ${summary.entryPoints.join(', ') || '(none detected)'}`,
    `Dependencies (what this area imports from outside itself): ${summary.dependencies.slice(0, 20).join(', ') || '(none)'}`,
    `Tested modules: ${summary.testedModules.length} / ${summary.modules.length}`,
    gitLog.length > 0 ? `Recent git history for this area:\n${gitLog.map((l) => `- ${l}`).join('\n')}` : 'No git history found for this area.',
    readme ? `Existing README for this area:\n${readme}` : 'No README found for this area.',
  ];

  const user =
    `${parts.join('\n\n')}\n\n` +
    `Propose the requirement and decision records this evidence actually supports (a thin or ` +
    `ambiguous area may honestly support only one, or none — never pad the count). Respond with a ` +
    `JSON array; each element exactly:\n` +
    `{"kind": "requirement"|"decision", "title": string, "body": string, "confidence": number between 0 and 1}\n` +
    `"confidence" must reflect how directly the evidence above supports THIS specific proposal — a ` +
    `single ambiguous file deserves low confidence, entry points plus tests plus a corroborating git ` +
    `history deserve higher confidence. Nothing else in the response.`;

  return { system, user };
}

/** Parses the model's raw response into proposals, or an error naming what was wrong with it. */
export function parseRecordProposals(raw: string): { proposals: RecordProposal[] } | { error: string } {
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: `response was not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!Array.isArray(parsed)) return { error: 'response was not a JSON array' };
  if (parsed.length === 0) return { error: 'expected at least one proposal, got 0' };
  if (parsed.length > MAX_PROPOSALS) return { error: `expected at most ${MAX_PROPOSALS} proposals, got ${parsed.length}` };

  const proposals: RecordProposal[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (typeof item !== 'object' || item === null) return { error: `item ${i} is not an object` };
    const obj = item as Record<string, unknown>;
    if (obj.kind !== 'requirement' && obj.kind !== 'decision') return { error: `item ${i} has an invalid "kind" (must be "requirement" or "decision")` };
    if (typeof obj.title !== 'string' || !obj.title.trim()) return { error: `item ${i} is missing a non-empty title` };
    if (typeof obj.body !== 'string' || !obj.body.trim()) return { error: `item ${i} is missing a non-empty body` };
    if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
      return { error: `item ${i} has an invalid "confidence" (must be a number between 0 and 1)` };
    }
    proposals.push({ kind: obj.kind, title: obj.title, body: obj.body, confidence: obj.confidence });
  }
  return { proposals };
}
