/**
 * T1 (agentic SDLC plan) — Graphify wired in as an MCP server.
 */

import { describe, it, expect } from 'vitest';
import { generateMCPConfig, generateMCPCommands } from '../src/init/mcp-generator.js';
import type { InitOptions } from '../src/init/types.js';
import { DEFAULT_INIT_OPTIONS, FULL_INIT_OPTIONS, MINIMAL_INIT_OPTIONS } from '../src/init/types.js';

function withGraphify(base: InitOptions, graphify: boolean): InitOptions {
  return { ...base, mcp: { ...base.mcp, graphify } };
}

describe('T1 — graphify MCP server registration', () => {
  it('appears in the generated config when enabled', () => {
    const config = generateMCPConfig(withGraphify(DEFAULT_INIT_OPTIONS, true)) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(config.mcpServers).toHaveProperty('graphify');
    expect(config.mcpServers.graphify.command).toMatch(/^python3?$/);
    expect(config.mcpServers.graphify.args).toEqual(['-m', 'graphify.serve', 'graphify-out/graph.json']);
  });

  it('is absent when disabled', () => {
    const config = generateMCPConfig(withGraphify(DEFAULT_INIT_OPTIONS, false)) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers).not.toHaveProperty('graphify');
  });

  it('is not wrapped in npx, unlike the Node-based servers', () => {
    const config = generateMCPConfig(withGraphify(DEFAULT_INIT_OPTIONS, true)) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(config.mcpServers.graphify.args).not.toContain('npx');
    expect(config.mcpServers.graphify.args).not.toContain('-y');
  });

  it('produces a matching manual claude mcp add command', () => {
    const cmds = generateMCPCommands(withGraphify(DEFAULT_INIT_OPTIONS, true));
    const cmd = cmds.find((c) => c.includes('graphify.serve'));
    expect(cmd).toBeDefined();
    expect(cmd).toMatch(/claude mcp add graphify/);
  });

  it('is on by default and stays on under FULL_INIT_OPTIONS', () => {
    expect(DEFAULT_INIT_OPTIONS.mcp.graphify).toBe(true);
    expect(FULL_INIT_OPTIONS.mcp.graphify).toBe(true);
    // Unlike ruvSwarm/flowNexus, graphify is not auth-gated, so --full without
    // --cloud-mcp (init.ts:615) has no reason to turn it back off.
  });

  it('MINIMAL_INIT_OPTIONS inherits the default (registered even in minimal init)', () => {
    expect(MINIMAL_INIT_OPTIONS.mcp.graphify).toBe(true);
  });
});
