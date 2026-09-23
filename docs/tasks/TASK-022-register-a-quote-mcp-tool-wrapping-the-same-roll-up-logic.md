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
contentHash: bfce938165e4ef777887dc20bc0eedc34ad8f550415e794ee83583c4a8da5841
provenance: agent-inferred
---

Expose the identical roll-up logic as an MCP tool, registered in mcp-client.ts's tool registry. This gives Claude Code, Cursor, and any generic MCP client the same answer the CLI gives. Share the roll-up function itself between the CLI command and the MCP tool handler. Do not duplicate the logic.
