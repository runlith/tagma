---
id: 01a1282d-bb77-731d-ba03-5cad108882e9
title: "MCP Apps stdio integration test fails on main too: next(shared) after revisions 2 and 3 never arrives within 1 s"
ord: 30
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12812-89b3-78cf-8d61-fdf7ece95215
sources:
  - kind: dir
    ref: packages/mcp
---
The MCP Apps stdio integration test in `packages/mcp` fails on the 21st check: after revisions 2 and 3 the `next(shared)` wait breaks with `Operation timed out after '1s'`. It fails the same way in the main checkout `/opt/workspaces/runlith`, so this is a shared resource-subscription defect, not spread cleanup. The publisher called `PubSub.publishUnsafe`, which does not apply sliding overflow: a slow shared reader held the old revision, the fresh publish was rejected. `Effect.runSync(PubSub.publish(...))` applies the sliding strategy; the original MCP Apps integration file passes, 5 pass.

Done when the test passes or the stale contract it holds is fixed.
