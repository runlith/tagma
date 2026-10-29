---
id: 01a17f62-c3f5-7598-99d7-c6aff4517840
title: submit_work refuses lines-held on a member-name match with a peer's new unrelated type
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "refused lines-held: \"selected references require uncommitted declarations: thread in native-harness/rows/native.ts:46, at in native.ts:47, held by 01a17f55…\" — those are members of a peer's new type ForkOrigin { thread; at } that context.ts never names; the only exits are waiting for a live peer, carrying its unfinished lines, or leaving out a file the rest of the commit needs to typecheck.",
    "command": "submit_work subject=\"Keep a moved thread's world, replays, call follower, notices and panes in its new home\" tasks=[26c5d6b8, 2512161e] in ~/runlith/tagma",
    "expected": "My held lines land: the changed line `worlds.of({ thread, ...request })` in native-harness/turns/context.ts uses no declaration of the peer's uncommitted lines."
  }
---
Filed from project `tagma`.

context.ts imports only the type `NativeThreadRows` from rows/native.ts. My changed line is an object literal passed to `Worlds.of` (type `WorldRequest`, declared in executions/contract/service/worlds.ts): a shorthand property `thread` and a spread of `{ at, root, projectId }`. The peer (fork-notice, thread 01a17f55-8e93-7de8-8618-0a7d71ad6e56) added `export type ForkOrigin = { readonly thread: string; readonly at: Date }` to native.ts. The conservative member-name check matched the names without a receiver type, although the receiver type here is provable (the argument type of `Worlds.of`). Leaving context.ts out would land a HEAD that does not typecheck, because `WorldRequest.projectId` is now required.