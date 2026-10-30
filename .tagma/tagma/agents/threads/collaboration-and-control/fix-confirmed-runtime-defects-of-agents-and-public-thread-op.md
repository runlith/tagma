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
The model-stream hypothesis in [[e9f93dfe|the long silent runs]] is refuted by the original records: thread 01a0c957-cae2-77e0-ab6a-38b3310ee6fa completed model step 13 (records 141 and 147), while grep 143 stayed pending until stop outcome 150; thread 01a0c964-6c84-7e27-aded-2fb0f6a8b2ae completed step 25 (161 and 163), while grep 162 stayed pending until stop outcome 164. The search/execution wait belongs to its owner; this establishes no fix of grep. [[45ed43fe|Grandchild graph reading]] still needs the original parent→child→grandchild scenario with home, worktree and a graph copy: ordinary crossing reading does not prove it.

Three causes are already fixed by prior commits and their reflections answered: [[b5e38a10|MCP-producer display.failed]] — 7a04ce67d5658dc5610972e2e7be17359f69bce5; [[d97ebd33|first opening of a missing rollout]] — 169b3d7999a75fc889e36d37fbc82c6c5ca8fdb4; [[feb7bf58|full thread-row renderer]] — abbe1a5bd86ed85c47828c9ae795f7543926fbad. 31 existing tests passed. On a separate tagma:try, cold-opening a fresh idle thread with no rollout ended with a public delete_thread and an empty list; stopping an active half-born run is separately unverified. No new checkout changes.

[[9d1e2bdb|A named child from another child's history]] is born by `spawn_agent` with `forkFrom` and `name`. Finishing the remaining work is a confirmed reproducer, a root fix at the owner, a narrow contract test and an independent review. The historical observations are not yet named as fixed.
