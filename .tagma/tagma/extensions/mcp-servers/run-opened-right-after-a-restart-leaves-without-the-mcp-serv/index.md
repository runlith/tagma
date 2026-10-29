---
id: 01a145cf-0dce-7f7d-a799-c642e72a12d7
title: Run opened right after a restart leaves without the MCP-server tools that are still connecting
ord: 4
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a145ce-5070-7faf-8412-78c62f1c1475
sources:
  - kind: file
    ref: packages/mcp/src/McpPool.ts
---
The thread's first run after the server restart (door opened 17:12:10Z, run 17:12:49Z) left without all 36 MCP-server tools of chrome-devtools and vidin, although the previous run carried them and 17 of them were expanded by the model and stood in the request. The comparison is composition records `10587` (before restart, 281 tools) and `10610` (after, 245). This thread's run at 17:14 had them again.

On this run the model loses the tools it worked with and gets "The deferred tools have changed". That was also the trigger of the false compaction [[2f1c1475]]: the estimate was untied from it, the tool loss itself remained.

The likely cause, unverified: the run catalog is assembled from `McpPool` servers already `connected`, and a `connecting` server gives no tools. Start where the native run takes the MCP catalog, and decide whether the run waits for the handshake of `connecting` servers or carries their last catalog. The proof is a test: a run opened while a declared server connects sends its tools.
