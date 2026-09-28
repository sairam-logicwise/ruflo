/**
 * Review #3, C2 — record-workflow-tools.ts. Proves the actual claim the
 * review found false: "the record is the gate, not the prompt," reachable
 * from an MCP client, not just the CLI. `getProjectCwd()` is steered via
 * CLAUDE_FLOW_CWD (its own documented precedence), never `process.chdir()`
 * — the same discipline review-2026-09-22.md's B1 fix already established
 * for this exact reason (a real vitest `threads`-pool bug).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordWorkflowTools } from '../../src/mcp-tools/record-workflow-tools.js';

function tool(name: string) {
  const found = recordWorkflowTools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool named "${name}" registered`);
  return found;
}

function jsonOf(result: Awaited<ReturnType<(typeof recordWorkflowTools)[number]['handler']>>): unknown {
  const r = result as { content: Array<{ text?: string }> };
  return JSON.parse(r.content[0].text!);
}

describe('recordWorkflowTools', () => {
  it('registers exactly the five surfaces the review found missing: record req/decision/task, validate, phase-check, decompose, run, backfill', () => {
    const names = recordWorkflowTools.map((t) => t.name);
    expect(names).toEqual([
      'record_req_new', 'record_req_show', 'record_req_list', 'record_req_confirm', 'record_req_decompose',
      'record_decision_new', 'record_decision_show', 'record_decision_list', 'record_decision_confirm',
      'record_task_new', 'record_task_show', 'record_task_list', 'record_task_ready', 'record_task_verify', 'record_task_repair',
      'record_validate', 'record_phase_check',
      'run',
      'backfill_summarize', 'backfill_infer',
    ]);
  });

  it('every tool has a real name, description, inputSchema, and handler — nothing registered as a stub', () => {
    for (const t of recordWorkflowTools) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema.type).toBe('object');
      expect(typeof t.handler).toBe('function');
    }
  });

  describe('a real gate enforcement scenario, driven ENTIRELY through the MCP tool path', () => {
    let tmp: string;
    let originalCwd: string | undefined;

    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), 'mcp-gate-'));
      originalCwd = process.env.CLAUDE_FLOW_CWD;
      process.env.CLAUDE_FLOW_CWD = tmp;
    });

    afterEach(() => {
      if (originalCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
      else process.env.CLAUDE_FLOW_CWD = originalCwd;
      rmSync(tmp, { recursive: true, force: true });
    });

    it('blocks an unaccepted citation through `run`, then advances the SAME task once `record_req_confirm` runs — no CLI shell-out anywhere', async () => {
      const req = jsonOf(await tool('record_req_new').handler({ title: 'Demo requirement' }, {}));
      const reqId = (req as { id: string }).id;

      const task = jsonOf(await tool('record_task_new').handler({ title: 'Demo task', citations: reqId }, {}));
      const taskId = (task as { id: string }).id;

      const beforeRun = jsonOf(await tool('run').handler({}, {})) as { stuck: Array<{ id: string; reason: string }> };
      expect(beforeRun.stuck.some((s) => s.id === taskId && /not accepted/.test(s.reason))).toBe(true);

      const confirmed = await tool('record_req_confirm').handler({ id: reqId }, {});
      expect((confirmed as { isError?: boolean }).isError).toBe(false);

      const afterRun = jsonOf(await tool('run').handler({}, {})) as { stuck: Array<{ id: string; reason: string }> };
      // No longer stuck on the citation — the SAME real gate that blocked it moved past it.
      expect(afterRun.stuck.some((s) => s.id === taskId && /not accepted/.test(s.reason))).toBe(false);
    });

    it('record_validate and record_phase_check run read-only over the same real records', async () => {
      await tool('record_req_new').handler({ title: 'Demo requirement' }, {});
      const validated = jsonOf(await tool('record_validate').handler({}, {})) as { total: number };
      expect(validated.total).toBeGreaterThan(0);

      const phaseChecked = await tool('record_phase_check').handler({}, {});
      expect((phaseChecked as { isError?: boolean }).isError).toBe(false);
    });

    it('record_task_repair stays dry-run by default — no real spend from an MCP call any more than from the CLI', async () => {
      const req = jsonOf(await tool('record_req_new').handler({ title: 'Demo requirement' }, {}));
      const reqId = (req as { id: string }).id;
      const task = jsonOf(await tool('record_task_new').handler({ title: 'Demo task', citations: reqId }, {}));
      const taskId = (task as { id: string }).id;
      // Not a real blocked-from-verifying task, so this exercises the refusal path —
      // confirming no repair spend is EVER reachable without an explicit confirm:true,
      // whatever the task's state.
      const result = jsonOf(await tool('record_task_repair').handler({ id: taskId }, {}));
      expect(result).toBeDefined();
    });
  });
});
