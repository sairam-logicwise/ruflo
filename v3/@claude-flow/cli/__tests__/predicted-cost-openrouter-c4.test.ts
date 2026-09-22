/**
 * C4 (review-2026-09-21.md) — predictedCostUsd must price the model that
 * actually executes, not the tier label. Under
 * CLAUDE_FLOW_ROUTER_PROVIDER=openrouter, the tier's OpenRouter alt is what
 * dispatches (agent-execute-core reads it from resolveExecutionProvider),
 * so pricing the anthropic tier label instead overstates cost by ~100x for
 * the haiku tier (Ling $0.01/$0.03 vs. Claude Haiku 4.5 $1.00/$5.00).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveExecutionProvider } from '../src/ruvector/model-router.js';
import { costUsd } from '../src/ruvector/model-prices.js';

// loadOpenRouterAlts() resolves the shipped openrouter-alts.json relative to
// this module's own location, not process.cwd() (B1, review-2026-09-22.md —
// the previous cwd-only probe returned null, and thus no openrouterModel,
// for any real `npx ruflo` invocation outside this repo, silently
// reintroducing C4's ~100x pricing bug). No env override needed below: this
// exercises the real resolution path and the real shipped asset directly.

describe('resolveExecutionProvider + costUsd composition (C4)', () => {
  afterEach(() => {
    delete process.env.CLAUDE_FLOW_ROUTER_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('resolves the haiku tier to its real OpenRouter alt under the openrouter provider', () => {
    process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';
    const exec = resolveExecutionProvider('haiku');
    expect(exec.provider).toBe('openrouter');
    expect(exec.openrouterModel).toBe('inclusionai/ling-2.6-flash');
  });

  it('prices the resolved alt, not the tier label — ~100x cheaper for haiku', () => {
    process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';
    const exec = resolveExecutionProvider('haiku');
    const priceId = exec.openrouterModel ?? 'haiku';

    const altCost = costUsd(priceId, 1_000_000, 0);
    const tierLabelCost = costUsd('haiku', 1_000_000, 0); // the bug: pricing this instead

    expect(priceId).toBe('inclusionai/ling-2.6-flash');
    expect(altCost).toBeCloseTo(0.01, 5);
    expect(tierLabelCost).toBeCloseTo(1.0, 5);
    expect(tierLabelCost / altCost).toBeGreaterThan(50); // the ~100x the review measured
  });

  it('falls back to the tier label under the anthropic provider (no alt to resolve)', () => {
    process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'anthropic';
    const exec = resolveExecutionProvider('haiku');
    expect(exec.provider).toBe('anthropic');
    expect(exec.openrouterModel).toBeUndefined();
  });

  it('every tier that has an OpenRouter alt prices without throwing', () => {
    process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';
    for (const tier of ['haiku', 'sonnet', 'opus', 'inherit'] as const) {
      const exec = resolveExecutionProvider(tier);
      const priceId = exec.openrouterModel ?? tier;
      expect(() => costUsd(priceId, 1000, 0)).not.toThrow();
    }
  });
});

describe('loadOpenRouterAlts resolution (B1, review-2026-09-22.md)', () => {
  // loadOpenRouterAlts() memoizes on first call per module instance, so each
  // scenario needs a fresh module. The cwd-independence case additionally
  // needs a REAL different cwd, and process.chdir() throws under vitest's
  // 'threads' pool ("process.chdir() is not supported in workers") — this
  // repo's own poolMatchGlobs override for that (already used by the
  // pre-existing router-bandit.test.ts) does not actually take effect when
  // vitest is invoked the way CI runs it (`cd v3 && pnpm test`), confirmed
  // by reproducing the identical TypeError on that existing file too. So:
  // avoid chdir entirely — spawn a real `tsx` subprocess with a different
  // `cwd`, which is both pool-agnostic and a more faithful reproduction of
  // the actual failure mode (a real `npx ruflo` invocation from a fresh
  // process, not an in-process cwd swap).
  let tmp: string;

  afterEach(() => {
    delete process.env.CLAUDE_FLOW_ROUTER_PROVIDER;
    delete process.env.CLAUDE_FLOW_ROUTER_OPENROUTER_ALTS;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves the real asset even when process.cwd() is nowhere near this repo', () => {
    tmp = mkdtempSync(join(tmpdir(), 'c4-cwd-'));
    const modelRouterUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ruvector', 'model-router.ts')).href;
    const probeScript = join(tmp, 'probe.mts');
    writeFileSync(
      probeScript,
      `process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';\n` +
        `import(${JSON.stringify(modelRouterUrl)}).then((m) => {\n` +
        `  console.log(JSON.stringify(m.resolveExecutionProvider('haiku')));\n` +
        `});\n`,
    );
    const result = spawnSync('npx', ['tsx', probeScript], { cwd: tmp, encoding: 'utf8' });
    expect(result.status, `tsx probe failed: ${result.stderr}`).toBe(0);
    const exec = JSON.parse(result.stdout.trim());
    expect(exec.openrouterModel).toBe('inclusionai/ling-2.6-flash');
  });

  it('resolves the real asset from the dist layout too, when dist is built', () => {
    // The src-dev candidate ('..','..','assets') is exercised by the test
    // above (vitest runs against .ts source). The dist candidate
    // ('..','..','..','assets', from dist/src/ruvector/) is a DIFFERENT
    // path and was never actually exercised (re-review-2026-09-22.md
    // flagged this gap explicitly) — skip gracefully if dist isn't built
    // rather than fail the suite on an unrelated build-step dependency.
    const distEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'src', 'ruvector', 'model-router.js');
    if (!existsSync(distEntry)) return; // not built in this environment — nothing to verify

    tmp = mkdtempSync(join(tmpdir(), 'c4-dist-'));
    const distUrl = pathToFileURL(distEntry).href;
    const probeScript = join(tmp, 'probe.mjs');
    writeFileSync(
      probeScript,
      `process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';\n` +
        `import(${JSON.stringify(distUrl)}).then((m) => {\n` +
        `  console.log(JSON.stringify(m.resolveExecutionProvider('haiku')));\n` +
        `});\n`,
    );
    const result = spawnSync('node', [probeScript], { cwd: tmp, encoding: 'utf8' });
    expect(result.status, `dist probe failed: ${result.stderr}`).toBe(0);
    const exec = JSON.parse(result.stdout.trim());
    expect(exec.openrouterModel).toBe('inclusionai/ling-2.6-flash');
  });

  it('the explicit env override still takes priority over module-relative resolution', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'c4-override-'));
    const fixturePath = join(tmp, 'alts.json');
    writeFileSync(fixturePath, JSON.stringify({
      tiers: { haiku: { anthropic_default: 'haiku', openrouter_alt: 'override/model', cost_per_m_tok_in: 9, cost_per_m_tok_out: 9 } },
    }));
    vi.resetModules();
    process.env.CLAUDE_FLOW_ROUTER_OPENROUTER_ALTS = fixturePath;
    process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';
    const { resolveExecutionProvider: freshResolve } = await import('../src/ruvector/model-router.js');
    const exec = freshResolve('haiku');
    expect(exec.openrouterModel).toBe('override/model');
  });
});
