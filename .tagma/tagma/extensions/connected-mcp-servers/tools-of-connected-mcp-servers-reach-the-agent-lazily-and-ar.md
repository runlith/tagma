---
id: 01a14c08-8336-7b3c-965a-b0924e9cc089
title: Tools of connected MCP servers reach the agent lazily and are judged by the server's declared capabilities
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14bc0-766c-7277-8b8e-47f50363c0ef
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b0918f8891ff
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/mcpPlaces.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/serverPool.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/mcp.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/mcpRule.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/mcpServers.ts
  - kind: file
    ref: packages/mcp/src/mcpToolCatalog.ts
---
**Value.** An agent uses tools of connected MCP servers on par with its own, and dozens of foreign tools do not eat its context.

**How.** An agent with the `mcp` capability gets the tools of every enabled server of the project under names `mcp__<server>__<tool>`, lazily: only names in the request, the full description unfolded through `tool_search`.

**Behaviour.**
- Before a turn, the project pool reconciles with the declarations: a new server starts, a removed one stops. The turn waits for the end of each started server's handshake — connection or failure — and only then assembles the catalog: the run's tool set does not grow further, so a server still connecting at assembly time would be left without tools until the next turn. A server whose past attempt under the same declaration failed is not waited on again: otherwise a broken server would hold every turn for its timeout. The pool is per project, the server process is shared by its threads.
- The server gets the project's roots at connect time: checkouts and worktrees of the project Tagma knows, and the scratch and attachment directories of all threads. Directories are shared, not per thread: a thread passes a file from the parent's scratch or a fork's attachment source, and the list does not grow with the thread count. So a server that caches roots accepts a thread's checkout and scratch from the first call. A worktree created or found later reaches live sessions via notification.
- In every call the server learns who calls and from which project.
- A server that crashed mid-run loses its tools at the very next step, not the next turn.
- A call is judged by the server's declared capabilities; a data-changing tool asks the operator in review.

**Limits.** A server declared or started mid-run serves tools only from the next turn. An agent without the `mcp` capability sees no servers. A place that appeared while the server was already connected — a new worktree or a thread's checkout outside the project — may not reach a server that updates roots with a delay or works over HTTP on the first call: MCP has no confirmation that the server has read the new list. A thread in an isolated world does not see the machine's server: its checkout is not in roots.
