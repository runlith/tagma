---
id: 01a12c87-608b-711a-bf63-fd5368e2e88a
title: Fix confirmed runtime defects of agents and public thread operations
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a0c97f-58ae-7ce0-825b-36dfe9f93dfe
---
Establish the causes of the remaining observations [[e9f93dfe|on stuck model calls]] and [[45ed43fe|on grandchild graph reading]] before changing the current runtime. The first needs a request or reproduction telling apart missing wire frames, connection-keeping pings, and waiting before wire entry; the current chain passes 300000 ms from the native kernel to liveness. The second needs the original parent→child→grandchild scenario with home, worktree and a graph copy: ordinary crossing reading does not prove it.

Three causes are already fixed by prior commits and their reflections answered: [[b5e38a10|MCP-producer display.failed]] — 7a04ce67d5658dc5610972e2e7be17359f69bce5; [[d97ebd33|first opening of a missing rollout]] — 169b3d7999a75fc889e36d37fbc82c6c5ca8fdb4; [[feb7bf58|full thread-row renderer]] — abbe1a5bd86ed85c47828c9ae795f7543926fbad. 31 existing tests passed. On a separate tagma:try, cold-opening a fresh idle thread with no rollout ended with a public delete_thread and an empty list; stopping an active half-born run is separately unverified. No new checkout changes.

[[9d1e2bdb|A named child from another child's history]] is born by `spawn_agent` with `forkFrom` and `name`. Finishing the remaining work is a confirmed reproducer, a root fix at the owner, a narrow contract test and an independent review. The historical observations are not yet named as fixed.
