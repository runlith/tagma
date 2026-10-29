---
id: 01a12393-b963-7331-8878-35262d90b3af
title: Keep the trial server's controlling terminal across Succession process changes
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123aa-3d04-7529-8b9c-1af758cf819e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12384-d893-74ea-b875-2c5793ceba06
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
The trial server must keep its launch owner across several process changes. In `installation/process/succession.ts` the successor is created with `detached: true`, detaches once ready and leaves the predecessor; `installation/cut/try.ts` awaits only the original child, so the terminal ends while the successor stays without its supervision. The automatic memory restart in `composition/server.ts` also invokes this chain; the fact is established by code reading, no real change ran in this check. Fix at the lifecycle owner: bind Succession to the launch owner, keeping the successor readiness check and the predecessor's orderly closing. Prove two consecutive changes on a separate root and port: the terminal stays running, and stopping it closes the current server, children and store writes with no residual. Never touch the working Tagma server.

Accepted 10 October 2026: an isolated `tagma:try` on port 6287 passed changes 29634 → 40392 → 41224 with the parent 24922 and the terminal PGID 24918 unchanged; the terminal stayed running. `stop_terminal` finished the tree on SIGHUP with no residual and unverifiable, the log confirmed closing of the thread stack, served graphs and machine runtime, the status returned `holder=null`. The server typecheck and 20 narrow tests passed; after one review Sol xhigh and Opus high additionally verified refusal on already-closed IPC and the orderly departure of the child after the owner's SIGKILL. The last typecheck was stopped by unrelated MCP changes: TS2554 in `McpApps.itest.ts` and `mcp/serverPool.ts`; it reported no errors in the changed Succession files. The checkout-registration side effect is split into [[680f8d02|the merge-driver isolation task]].
