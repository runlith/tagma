---
id: 01a0df10-2869-7c0d-bb5a-f95637439dcf
title: "`sync_graph` over HTTP answers `not-a-team-tree` for a team project: the operation reads `TreeCommits` from a context that never carries it"
ord: 152
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/commits.ts
    symbol: TreeCommits
  - kind: symbol
    ref: apps/tagma/server/src/landing/operations/submit.ts
    symbol: SUBMIT_PAIRS
---
Seen while writing `enforcement/ownGit.stest.ts` (task e11572f0): in a project registered with `storage: 'team'`, `tagma op sync_graph` answered `{"code":"not-a-team-tree"}` right after `create_block` had written the tree. `operations/projects.ts` `sync_graph` reads `yield* TreeCommits`, a `Context.Reference` that only the served graph's own context carries (`http/MirrorBuilder.ts` adds it); the HTTP operation road provides the routed machine context plus `CurrentGraph`, where the reference falls back to `undefined`, so `syncGraph` refuses as if the tree were Tagma's own git. `http/handlers/files.ts` `sync` goes through the same `performHttp` road. The native tool road was not checked.

Done when a team project's `sync_graph` over HTTP (and the files door's `sync`) commits the tree, with a test through the HTTP door.