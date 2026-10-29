---
id: 01a15067-29fe-72ce-9341-e6dcdff007f4
title: Turn opened while a declared MCP server connects waits for its handshake to end before assembling the catalog
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15063-f85b-7d77-816c-6b330678d280",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a145cf-0dce-7f7d-a799-c642e72a12d7
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/serverPool.ts
  - kind: file
    ref: packages/mcp/src/McpPool.ts
---
A turn opened while a declared MCP server connects waits for its handshake to end before assembling the catalog.

Thread `01a15051-33b0-7c7c-bf18-4afe7dd38560` (demo-player) lost every chrome-devtools tool after the server restart at 18:57:26Z: the run was adopted by the successor at 18:57:47Z, while chrome-devtools and vidin became `connected` at 18:57:48Z. Since then `mcp__chrome-devtools__navigate_page` refused as unknown, and `tool_search select:…` answered `missing` — the run catalog did not hold them. The `mcp__tagma__` prefix in names the agent noticed is the Claude Code form on the wire; the translation removes it (the `toolSearchInput` in the step), and it is not the cause.

Cause: `McpServers.reconcile` (prepare `mcp` capability) only starts the handshake in the background, while the run catalog is assembled right after it from the `palette`, where only `connected` servers stand. The catalog resolves once per run (and at the restored-context boundary); `mcpRule` can only remove the tools of a fallen server, with nothing to add the tools of one that connected — so a run without them stays without them to the end.

The fix at the owner: `reconcile(projectId)` answers when every started server's handshake ended — by connecting or failing. A retry of a server that failed with the same declaration is not awaited by the turn. Two more places from the review (gpt-6.1-sol xhigh), without which waiting is dangerous: `mcpConnect` is now capped by the declaration's whole timeout — the SDK waited for `notifications/initialized` over HTTP with no deadline, and a handshake could hang forever; `RunScheduler.adopt` holds the adopted run as `launching` while the transport prepares it — otherwise preparing longer than the heartbeat interval removed the run from beating before `execution.adopted`.

Proof: `McpServers.stest.ts` — right after `reconcile` the palette carries the declared server; `McpSession.test.ts` — a server that never accepted `notifications/initialized` fails the open with `McpTimedOut` on its own timeout. Both red on the old code. Holding the adopted run is not proved by test: there is no cheap world with a real `RunScheduler`; the change repeats the `resume` form.
