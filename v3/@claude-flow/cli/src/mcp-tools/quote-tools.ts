/**
 * quote-tools.ts — MCP surface for `ruflo quote` (T11/TASK-022, agentic
 * SDLC plan). Wraps the same `estimator/quote.ts` roll-up logic the CLI
 * command uses, so an MCP client gets an identical result to a human
 * running `ruflo quote` — one roll-up implementation, two entry points.
 *
 * @module mcp-tools/quote-tools
 */

import type { MCPTool, MCPToolResult } from './types.js';
import { getProjectCwd } from './types.js';
import { quoteRequirement, quoteBacklog, listAllRequirementIds, type QuoteOptions } from '../ruvector/estimator/quote.js';
import { UnknownModelPriceError } from '../ruvector/model-prices.js';

function textResult(data: unknown): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): MCPToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function readOptions(input: Record<string, unknown>): QuoteOptions {
  return {
    ...(typeof input.k === 'number' ? { k: input.k } : {}),
    ...(typeof input.retryMultiplier === 'number' ? { retryMultiplier: input.retryMultiplier } : {}),
    ...(typeof input.priceId === 'string' ? { priceId: input.priceId } : {}),
  };
}

export const quoteTools: MCPTool[] = [
  {
    name: 'quote_requirement',
    description: "Roll T10's token/cost estimate up across a requirement's decomposed tasks (T11) and price it — a range with a confidence level, never a point estimate.",
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string', description: 'Requirement id to quote, e.g. REQ-001' },
        k: { type: 'number', description: 'Neighbours considered per task (default 5)' },
        retryMultiplier: { type: 'number', description: 'Retry/repair buffer on the high end of each task range (default 1.3)' },
        priceId: { type: 'string', description: 'Model id to price against (model-prices.ts, default "sonnet")' },
      },
      required: ['requirementId'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const requirementId = input.requirementId as string | undefined;
      if (!requirementId) return errorResult('requirementId is required');
      try {
        const result = quoteRequirement(getProjectCwd(), requirementId, readOptions(input));
        if (!result.ok) return errorResult(result.reason);
        return textResult(result.quote);
      } catch (err) {
        if (err instanceof UnknownModelPriceError) return errorResult(err.message);
        throw err;
      }
    },
  },
  {
    name: 'quote_backlog',
    description: "Roll T10's token/cost estimate up across MULTIPLE requirements (T11) — sums every requirement's quote into one range. Omit requirementIds to quote every requirement on disk.",
    inputSchema: {
      type: 'object',
      properties: {
        requirementIds: { type: 'array', description: 'Requirement ids to quote and sum. Omit to quote every requirement on disk.', items: { type: 'string' } },
        k: { type: 'number', description: 'Neighbours considered per task (default 5)' },
        retryMultiplier: { type: 'number', description: 'Retry/repair buffer on the high end of each task range (default 1.3)' },
        priceId: { type: 'string', description: 'Model id to price against (model-prices.ts, default "sonnet")' },
      },
    },
    handler: async (input): Promise<MCPToolResult> => {
      const cwd = getProjectCwd();
      const ids = Array.isArray(input.requirementIds) && input.requirementIds.every((v) => typeof v === 'string')
        ? (input.requirementIds as string[])
        : listAllRequirementIds(cwd);
      try {
        return textResult(quoteBacklog(cwd, ids, readOptions(input)));
      } catch (err) {
        if (err instanceof UnknownModelPriceError) return errorResult(err.message);
        throw err;
      }
    },
  },
];
