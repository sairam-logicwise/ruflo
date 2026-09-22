#!/usr/bin/env node
/**
 * install-git-hooks.mjs — copies scripts/hooks/* into .git/hooks/* (T5,
 * agentic SDLC plan). `.git/hooks/` is never version-controlled, so the
 * files under scripts/hooks/ are the actual source of truth; this script
 * is how they land where git will run them.
 *
 * Wired to the root package.json's `prepare` script, so `npm install`
 * keeps hooks current automatically. Safe to run standalone too:
 *   node scripts/install-git-hooks.mjs
 *
 * Skips silently (exit 0) outside a git checkout (e.g. installed as a
 * dependency, or a `.git` directory that doesn't exist) — hooks only make
 * sense in a real clone of this repo.
 *
 * Runs on every `npm install` via `prepare`, so a contributor's own hook
 * (husky, a personal `pre-commit`) must never be silently destroyed
 * (Important 16, review-2026-09-21.md). An existing hook file is only
 * overwritten when it's byte-identical (no-op) or carries our own marker
 * comment (an older version of a file this script installed before) —
 * otherwise it's left alone and `--force` is required.
 */

import { existsSync, mkdirSync, copyFileSync, chmodSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, 'scripts', 'hooks');
const gitDir = join(repoRoot, '.git');
const hooksDir = join(gitDir, 'hooks');
const FORCE = process.argv.includes('--force');
const OUR_MARKER = 'agentic SDLC plan'; // present in every scripts/hooks/* header

if (!existsSync(gitDir)) {
  process.exit(0);
}

mkdirSync(hooksDir, { recursive: true });

for (const name of readdirSync(sourceDir)) {
  const src = join(sourceDir, name);
  const dest = join(hooksDir, name);
  const srcContent = readFileSync(src, 'utf8');

  if (existsSync(dest)) {
    const destContent = readFileSync(dest, 'utf8');
    if (destContent === srcContent) {
      continue; // already up to date
    }
    if (!destContent.includes(OUR_MARKER) && !FORCE) {
      console.warn(
        `[install-git-hooks] .git/hooks/${name} already exists and doesn't look like ours ` +
          `(e.g. husky or a personal hook) — leaving it in place. Re-run with --force to ` +
          `overwrite, or remove .git/hooks/${name} yourself first.`,
      );
      continue;
    }
  }

  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log(`[install-git-hooks] installed ${name}`);
}
