#!/usr/bin/env node
// estimator-holdout-check.mjs — T10, agentic SDLC plan. Leave-one-out
// hold-out test over the real calibration set: for each real task record
// with `actuals`, predict its range from every OTHER real calibration row
// (never itself — that would trivially "predict" its own answer) plus the
// real trajectory corpus if one exists, then check whether its own real
// actual total falls inside the predicted range. Reports the hit rate —
// the accuracy baseline plan.md's own verification criterion asks for.
//
// Usage: node scripts/estimator-holdout-check.mjs

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCalibrationRows, loadEstimatorCorpus, buildUnifiedCorpus } from '../v3/@claude-flow/cli/dist/src/ruvector/estimator/corpus.js';
import { predictTokens } from '../v3/@claude-flow/cli/dist/src/ruvector/estimator/predict.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const calibrationRows = loadCalibrationRows(REPO_ROOT);
const trajectory = loadEstimatorCorpus(resolve(REPO_ROOT, '.swarm', 'model-router-trajectories.jsonl'));

if (calibrationRows.length === 0) {
  console.log('No calibration rows with actuals found under docs/tasks/ — nothing to hold out.');
  process.exit(0);
}

let hits = 0;
const results = [];
for (let i = 0; i < calibrationRows.length; i++) {
  const heldOut = calibrationRows[i];
  const rest = calibrationRows.filter((_, j) => j !== i);
  const corpus = buildUnifiedCorpus(trajectory.rows, rest);

  const prediction = predictTokens(heldOut.complexity, corpus);
  const actualTotal = heldOut.inputTokens + heldOut.outputTokens;

  if (!prediction.ok) {
    results.push({ i, hit: false, reason: prediction.reason });
    continue;
  }
  const hit = actualTotal >= prediction.estimate.lowTokens && actualTotal <= prediction.estimate.highTokens;
  if (hit) hits++;
  results.push({
    i,
    hit,
    actualTotal,
    low: prediction.estimate.lowTokens,
    high: prediction.estimate.highTokens,
    confidence: prediction.estimate.confidence,
  });
}

for (const r of results) {
  if (r.reason) {
    console.log(`[${r.i}] no prediction: ${r.reason}`);
  } else {
    console.log(`[${r.i}] ${r.hit ? 'HIT ' : 'MISS'} actual=${r.actualTotal} range=[${r.low},${r.high}] confidence=${r.confidence.toFixed(2)}`);
  }
}

const hitRate = hits / calibrationRows.length;
console.log(`\nHit rate: ${hits}/${calibrationRows.length} (${(hitRate * 100).toFixed(1)}%)`);
console.log(`Trajectory corpus rows available: ${trajectory.rows.length} (${trajectory.rows.length === 0 ? 'none — CLAUDE_FLOW_ROUTER_TRAJECTORY has never been enabled in this checkout' : 'in the mix as a prior'})`);
