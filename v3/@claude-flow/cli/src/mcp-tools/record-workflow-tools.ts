/**
 * record-workflow-tools.ts — Review #3, C2. MCP tools for every real
 * command this plan built: `record req|decision|task`, `record
 * validate`/`phase-check`/`decompose`, `run`, and `backfill
 * summarize|infer` — the exact five surfaces the review named as
 * missing. Each tool is a thin wrapper (`command-bridge.ts`) over the
 * SAME `Command` the CLI itself runs; no logic is duplicated here.
 *
 * @module mcp-tools/record-workflow-tools
 */

import type { Command } from '../types.js';
import type { MCPTool } from './types.js';
import { runCommandAsTool } from './command-bridge.js';
import recordCommand from '../commands/records.js';
import backfillCommand from '../commands/backfill.js';
import runCommand from '../commands/run.js';

/** Walks a Command's subcommand tree by name — the same traversal every test file's own `sub()` helper already does, generalized here so this module never needs records.ts/backfill.ts to export their private leaf commands individually. */
function findSubcommand(root: Command, ...path: string[]): Command {
  let current = root;
  for (const name of path) {
    const next = current.subcommands?.find((c) => c.name === name);
    if (!next) throw new Error(`command-bridge: no subcommand "${name}" under "${current.name}" — has records.ts/backfill.ts's shape changed?`);
    current = next;
  }
  return current;
}

const reqNew = findSubcommand(recordCommand, 'req', 'new');
const reqShow = findSubcommand(recordCommand, 'req', 'show');
const reqList = findSubcommand(recordCommand, 'req', 'list');
const reqConfirm = findSubcommand(recordCommand, 'req', 'confirm');
const reqDecompose = findSubcommand(recordCommand, 'req', 'decompose');
const decisionNew = findSubcommand(recordCommand, 'decision', 'new');
const decisionShow = findSubcommand(recordCommand, 'decision', 'show');
const decisionList = findSubcommand(recordCommand, 'decision', 'list');
const decisionConfirm = findSubcommand(recordCommand, 'decision', 'confirm');
const taskNew = findSubcommand(recordCommand, 'task', 'new');
const taskShow = findSubcommand(recordCommand, 'task', 'show');
const taskList = findSubcommand(recordCommand, 'task', 'list');
const taskReady = findSubcommand(recordCommand, 'task', 'ready');
const taskVerify = findSubcommand(recordCommand, 'task', 'verify');
const taskRepair = findSubcommand(recordCommand, 'task', 'repair');
const recordValidate = findSubcommand(recordCommand, 'validate');
const phaseCheck = findSubcommand(recordCommand, 'phase-check');
const backfillSummarize = findSubcommand(backfillCommand, 'summarize');
const backfillInfer = findSubcommand(backfillCommand, 'infer');

const idParam = { id: { type: 'string', description: 'Record id, e.g. REQ-001, DEC-001, or TASK-001' } };
const bodyParams = {
  title: { type: 'string', description: 'Record title' },
  body: { type: 'string', description: 'Markdown body text' },
  provenance: { type: 'string', description: '"human" or "agent-inferred"' },
  confidence: { type: 'number', description: 'T24: 0-1, how much real evidence backed an inferred proposal (omit for a human-authored record)' },
};

export const recordWorkflowTools: MCPTool[] = [
  {
    name: 'record_req_new',
    description: 'Create a new requirement record (draft — accepted only via record_req_confirm). Same command as `ruflo record req new`.',
    inputSchema: { type: 'object', properties: { ...bodyParams, supersedes: { type: 'string', description: 'Comma-separated requirement ids this supersedes' } }, required: ['title'] },
    handler: (input) => runCommandAsTool(reqNew, input),
  },
  {
    name: 'record_req_show',
    description: 'Show a requirement record. Same command as `ruflo record req show`.',
    inputSchema: { type: 'object', properties: idParam, required: ['id'] },
    handler: (input) => runCommandAsTool(reqShow, input),
  },
  {
    name: 'record_req_list',
    description: 'List requirement records. Same command as `ruflo record req list`.',
    inputSchema: { type: 'object', properties: {} },
    handler: (input) => runCommandAsTool(reqList, input),
  },
  {
    name: 'record_req_confirm',
    description: 'Promote a draft requirement to accepted (T24) — the human-confirmation step, never self-serviceable at creation. Same command as `ruflo record req confirm`.',
    inputSchema: { type: 'object', properties: idParam, required: ['id'] },
    handler: (input) => runCommandAsTool(reqConfirm, input),
  },
  {
    name: 'record_req_decompose',
    description: 'Decompose an accepted requirement into task records, grounded in the code graph (T6). Dry-run by default — pass yes:true to write. Same command as `ruflo record req decompose`.',
    inputSchema: {
      type: 'object',
      properties: {
        ...idParam,
        yes: { type: 'boolean', description: 'Actually write the proposed tasks (default: dry-run, prints proposals only)' },
        fromFile: { type: 'string', description: 'Read proposals from this JSON file instead of calling the LLM' },
        model: { type: 'string', description: 'Anthropic model id to use for decomposition' },
      },
      required: ['id'],
    },
    handler: (input) => runCommandAsTool(reqDecompose, input),
  },
  {
    name: 'record_decision_new',
    description: 'Create a new decision record (draft — accepted only via record_decision_confirm). Same command as `ruflo record decision new`.',
    inputSchema: {
      type: 'object',
      properties: { ...bodyParams, citations: { type: 'string', description: 'Comma-separated ids this decision cites' }, supersedes: { type: 'string' }, related: { type: 'string' } },
      required: ['title'],
    },
    handler: (input) => runCommandAsTool(decisionNew, input),
  },
  {
    name: 'record_decision_show',
    description: 'Show a decision record. Same command as `ruflo record decision show`.',
    inputSchema: { type: 'object', properties: idParam, required: ['id'] },
    handler: (input) => runCommandAsTool(decisionShow, input),
  },
  {
    name: 'record_decision_list',
    description: 'List decision records. Same command as `ruflo record decision list`.',
    inputSchema: { type: 'object', properties: {} },
    handler: (input) => runCommandAsTool(decisionList, input),
  },
  {
    name: 'record_decision_confirm',
    description: 'Promote a draft decision to accepted (T24) — the human-confirmation step. Same command as `ruflo record decision confirm`.',
    inputSchema: { type: 'object', properties: idParam, required: ['id'] },
    handler: (input) => runCommandAsTool(decisionConfirm, input),
  },
  {
    name: 'record_task_new',
    description: 'Create a new task record — always drafted, must cite at least one requirement or decision. Same command as `ruflo record task new`.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        citations: { type: 'string', description: 'Comma-separated ids — must include at least one requirement or decision' },
        priority: { type: 'string', description: 'p0|p1|p2' },
        dependsOn: { type: 'string', description: 'Comma-separated task ids that must complete first' },
        body: { type: 'string' },
        provenance: { type: 'string' },
      },
      required: ['title', 'citations'],
    },
    handler: (input) => runCommandAsTool(taskNew, input),
  },
  {
    name: 'record_task_show',
    description: 'Show a task record. Same command as `ruflo record task show`.',
    inputSchema: { type: 'object', properties: idParam, required: ['id'] },
    handler: (input) => runCommandAsTool(taskShow, input),
  },
  {
    name: 'record_task_list',
    description: 'List task records. Same command as `ruflo record task list`.',
    inputSchema: { type: 'object', properties: {} },
    handler: (input) => runCommandAsTool(taskList, input),
  },
  {
    name: 'record_task_ready',
    description: 'Declare a task ready for verification (implementing -> verifying, Important 6) — the one deliberate human/agent judgement call in this lifecycle. Same command as `ruflo record task ready`.',
    inputSchema: { type: 'object', properties: idParam, required: ['id'] },
    handler: (input) => runCommandAsTool(taskReady, input),
  },
  {
    name: 'record_task_verify',
    description: 'Run the required tests for a task and derive its status from the real result (T19) — done is unreachable without a green test. Same command as `ruflo record task verify`.',
    inputSchema: { type: 'object', properties: { ...idParam, command: { type: 'string', description: "Override the test command (defaults to the project's own npm test)" } }, required: ['id'] },
    handler: (input) => runCommandAsTool(taskVerify, input),
  },
  {
    name: 'record_task_repair',
    description: 'Bounded, budget-capped repair of a task blocked by a red test (T20) — dry-run by default, confirm:true to actually spend. Same command as `ruflo record task repair`.',
    inputSchema: {
      type: 'object',
      properties: {
        ...idParam,
        confirm: { type: 'boolean', description: 'Actually spend budget on repair (default: print the plan only)' },
        maxAttempts: { type: 'number', description: 'Outer bound on repair rounds (default 3)' },
        budget: { type: 'number', description: 'Total budget in USD across all rounds (default 5)' },
        model: { type: 'string', description: 'Model tier for the headless repair agent (default haiku)' },
      },
      required: ['id'],
    },
    handler: (input) => runCommandAsTool(taskRepair, input),
  },
  {
    name: 'record_validate',
    description: 'Validate every requirement, decision, and task record against its schema. Same command as `ruflo record validate`.',
    inputSchema: { type: 'object', properties: { fix: { type: 'boolean', description: 'Recompute and rewrite contentHash for records that fail ONLY a hash mismatch' } } },
    handler: (input) => runCommandAsTool(recordValidate, input),
  },
  {
    name: 'record_phase_check',
    description: "Audit every task record for state-machine consistency (T17, review #3 C1) — flags a task whose current status is no longer earned by its current fields, including a done task with no real verification receipt. Read-only. Same command as `ruflo record phase-check`.",
    inputSchema: { type: 'object', properties: {} },
    handler: (input) => runCommandAsTool(phaseCheck, input),
  },
  {
    name: 'run',
    description: "The autonomy loop (T25) — advances every task with a real, evidenced next step; stops and reports the rest as needing a human. Same command as `ruflo run`. This is the actual gate: enforcing it here, not just in the CLI, is the fix for review #3 C2.",
    inputSchema: {
      type: 'object',
      properties: {
        repair: { type: 'boolean', description: 'Also attempt bounded repair on tasks blocked by a red test (T20) — at most once per task per run' },
        confirm: { type: 'boolean', description: 'Actually spend on repair (forwarded to repair-loop.ts; no effect without repair:true)' },
        maxRepairAttempts: { type: 'number' },
        repairBudget: { type: 'number' },
        model: { type: 'string' },
        spendCeiling: { type: 'number', description: 'Total USD spend ceiling across every repair this run (T26)' },
      },
    },
    handler: (input) => runCommandAsTool(runCommand, input),
  },
  {
    name: 'backfill_summarize',
    description: 'Summarize one area of the codebase from the Graphify graph — modules, dependencies, entry points, test presence. No model calls, no token cost (T23). Same command as `ruflo backfill summarize`.',
    inputSchema: { type: 'object', properties: { area: { type: 'string', description: 'Path prefix to summarize, e.g. v3/@claude-flow/cli/src/ruvector/' } }, required: ['area'] },
    handler: (input) => runCommandAsTool(backfillSummarize, input),
  },
  {
    name: 'backfill_infer',
    description: 'Propose requirement and decision records for one area, grounded in its real structure, git history, and docs (T24) — every proposal is draft/agent-inferred/confidence-scored, never auto-accepted. Dry-run by default — pass yes:true to write. Same command as `ruflo backfill infer`.',
    inputSchema: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'Path prefix to infer from, e.g. v3/@claude-flow/cli/src/ruvector/estimator/' },
        yes: { type: 'boolean', description: 'Actually write the proposed records (default: dry-run, prints proposals only)' },
        fromFile: { type: 'string', description: 'Read proposals from this JSON file instead of calling the LLM' },
        model: { type: 'string' },
      },
      required: ['area'],
    },
    handler: (input) => runCommandAsTool(backfillInfer, input),
  },
];
