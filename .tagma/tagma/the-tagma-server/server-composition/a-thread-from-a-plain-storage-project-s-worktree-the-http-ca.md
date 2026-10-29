---
id: 01a14094-c3c2-7725-8771-345a1510a61b
title: "A thread from a plain-storage project's worktree: the HTTP call gets main's working root, not the worktree's"
ord: 14
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a13f2d-638d-74e9-8a14-33acd1cc7192
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/doorParity.stest.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/place.ts
---
An observation from porting `doorParity` to Effect (an unverified hypothesis of the cause; the divergence is fact).

A thread of a `storage: 'plain'` project moved by `move_thread` to a worktree gets `strip_comments` over the main checkout's root on the HTTP door: the response is `read: 0`, and a file written in the worktree is unreadable; the same thread's native door works in the worktree (`read: 1`, `dropped: 1`). For `storage: 'stealth'` both doors agree; the `doorParity.stest.ts` test holds that.

Hypothesis: in `place.ts` the call's working root is taken as `served?.checkout ?? place.checkout ?? project.rootPath`, while a plain project's graph is served from the main checkout, so `CallerWorkspace.root` becomes the graph's root rather than the root where the thread stands. Unverified: needs a run of the plain `doorParity` variant printing `CallerWorkspace.root`.

Completion proof: the plain variant of the "a thread placed in a worktree writes into that worktree at both doors" test is green.
