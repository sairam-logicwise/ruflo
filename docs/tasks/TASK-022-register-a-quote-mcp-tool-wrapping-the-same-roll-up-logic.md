---
id: TASK-022
title: Register a quote MCP tool wrapping the same roll-up logic
status: drafted
priority: p2
createdAt: 2026-09-23T07:20:04.209Z
updatedAt: 2026-09-23T07:20:04.209Z
citations:
  - REQ-001
dependsOn: []
doneCriteria:
  testLayers:
    - unit
contentHash: ad628e32737b7e4a9695f9a6246983b35298ec820681e87c232504b11e4c78c5
provenance: agent-inferred
---

Expose the identical roll-up logic as an MCP tool, registered in mcp-client.ts's tool registry. This gives Claude Code, Cursor, and any generic MCP client the same answer the CLI gives. Share the roll-up function itself between the CLI command and the MCP tool handler. Do not duplicate the logic.
