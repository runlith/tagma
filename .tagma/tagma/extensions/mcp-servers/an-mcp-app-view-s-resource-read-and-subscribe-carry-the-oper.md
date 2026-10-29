---
id: 01a12407-7c8d-726d-b564-ffa7155da6fb
title: An MCP App view's resource read and subscribe carry the operator caller with project and view resource
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1231d-b9cc-7eb6-be22-add828aa44c4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a123fe-04cc-720b-a4fb-0122b5ae34d8
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/serverPool.ts
---
Another's MCP App view calls `tools/call` with caller `operator {projectId, view}`, but `read_mcp_resource` and `mcp.resource.subscribe` (`mcp/serverPool.ts` appRead/appWatch) go without a caller. MCP pools are split by project, so another project's stdio server is unreachable. But a shared HTTP MCP service serving several projects cannot scope a resource to the caller's project. The view resource (`display.app.resource`) must be kept in the mount and on the read and subscribe wire, and the caller passed the way plugin views do ([[b2c7cbe2]]).

Done when the `mcp` itest shows the server sees the caller with the view's project and resource on read and subscribe.
