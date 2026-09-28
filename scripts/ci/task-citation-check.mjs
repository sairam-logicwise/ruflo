#!/usr/bin/env node
/**
 * task-citation-check.mjs — T17, agentic SDLC plan (tasks/plan.md). I/O
 * wrapper for the pure logic in ./task-citation-check-lib.mjs: diffs
 * base...head and reports whether a code change rode along with a
 * docs/tasks/ record change.
 *
 * ADVISORY ONLY by design (D4, plan.md: "Sairam enables branch protection
 * on the day this task merges, not before"). Wired into
 * .github/workflows/sdlc-gate.yml as a normal (non-required) job — it
 * runs and reports on every PR, but nothing blocks a merge until branch
 * protection is turned on separately, which is explicitly the repo
 * owner's call, not this script's.
 *
 * Usage: node scripts/ci/task-citation-check.mjs <base-ref> <head-ref>
 */

import { execFileSync } from 'node:child_process';
import { checkTaskCitation } from './task-citation-check-lib.mjs';

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error('Usage: node scripts/ci/task-citation-check.mjs <base-ref> <head-ref>');
  process.exit(2);
}

const changed = execFileSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const result = checkTaskCitation(changed);
if (result.ok) {
  console.log(`[OK] ${result.reason}`);
  process.exit(0);
}

console.error(`[ADVISORY] ${result.reason}`);
console.error('  Add or update a record under docs/tasks/ in this PR, or confirm this change genuinely needs none.');
for (const f of result.nonDocsChanges) console.error(`  - ${f}`);
process.exit(1);
