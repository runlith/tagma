---
id: 01a0e532-cd97-7aa9-871a-73f6f2efd51b
title: "socket M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-c8fe-7e28-a96f-0163155e2b41
  - kind: waits-on
    to: 01a0e532-c9fd-7bd4-a50c-bd345b1c2c01
  - kind: waits-on
    to: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
  - kind: waits-on
    to: 01a0e532-caf3-7065-8c3c-c19e418f681b
  - kind: waits-on
    to: 01a0e532-cb18-7a9a-ad75-92f7cea4a39a
  - kind: waits-on
    to: 01a0e532-cb8a-7bef-9a85-b3ffc595c5f9
  - kind: waits-on
    to: 01a0e532-cbfc-7817-83e6-7d22191594cc
  - kind: waits-on
    to: 01a0e532-cc6c-73df-a111-c28429ce4645
  - kind: waits-on
    to: 01a0e532-ccc1-799b-82bd-bde34047bdcd
  - kind: waits-on
    to: 01a0e532-cd8e-739e-9e53-48519485548f
---
§7.2.2 milestone `M2` of the `socket` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

Progress: owner feeds derived via `rpcOf` for graph, checkout, changes, accounts, awake, pace (`afe0d2ed75`) and the eleven execution feeds (`53d1254b23`). `worktrees.subscribe` and `calls.subscribe` derived too (`34bdfb611f`); thread feeds and the twelve `thread.*` verbs declared in `threads/contract/wire/feeds.ts` and `native-harness/contract/wire/threadFeeds.ts` as non-streaming declarations, so every RPC in `socket/rpc.ts` now comes from `rpcOf(<owner declaration>)` (`8f0558236c`). Open: the group is still a hand-listed set of `rpcOf` lines, and the app imports it as a browser entry (`app/src/lib/wire/Live.ts`). Formerly hand-made: `thread.subscribe`, `threads.subscribe` and the twelve `thread.*` acts (threads M2).