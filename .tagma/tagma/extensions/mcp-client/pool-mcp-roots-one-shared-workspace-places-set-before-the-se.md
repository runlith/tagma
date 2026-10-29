---
id: 01a13fb8-c0e5-764b-b6b2-68d5ee0e0a33
title: "Pool MCP roots — one shared workspace: places set before the session opens reach the server in the first roots/list"
ord: 22
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/mcp/src/McpPool.ts
  - kind: file
    ref: packages/mcp/src/McpRoots.ts
  - kind: file
    ref: packages/mcp/src/sdk.ts
---
A server that validates paths against roots usually caches the list and refreshes it in the background on `notifications/roots/list_changed` (chrome-devtools-mcp does this). MCP has no acknowledgement that the server applied the new list: neither the notification nor a ping says its cache is updated. So only the list the server already holds is timing-independent. Roots issued for the duration of a call and removed after it left such a server with an empty or stale list, and a race decided whether a path was accepted.

Pool roots are a single workspace shared by all its sessions. The embedding product sets the places before the pool opens its first session (`McpPool.place`), and replaces them wholesale when the space itself changes. A session receives them in the first `roots/list` after initialize, so the server accepts a path inside these places from the first call, however it caches. A place outside the space that a call brought in is added and kept until the pool ends or until a replacement of the places covers it. A path inside a known place does not change the list. Roots describe the project space; the call's identity is carried by caller in `_meta`.

A list change reaches every live pool session as a `list_changed` notification, and a session call that has not yet reconciled the new version waits for its reconciliation. Reconciliation is the notification followed by a ping; if the server asked `roots/list` in the meantime, the call waits for the response to be sent plus one more ping. So `tools/call` lands after the new list is handled only for a server that requests roots directly in the notification handler, and only over stdio, where the server request and the ping response travel one channel in order. A server that defers the update, and HTTP, where the server request travels a separate SSE stream, give no such ordering: they may not accept a place that appeared during a live session on the first call.
