---
id: 01a12b3b-24fd-76bb-9746-fa49f7eef143
title: "Chat feed stops following the fold after an effect rerun with no fold changes: confirmation card hangs after the answer, click gives `There is no open question here`"
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12b12-a3a2-7e2c-b91a-997500c6640b",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/VisibleFeed.ts
---
`VisibleFeed.sync` in the "no new fold changes" branch returned without reading `source.revision`. The `ChatSurface` effect calling `sync` lost its dependency on the fold after such a restart (only the run phase changed, e.g. parking on a question) and no longer restarted on its changes: feed, live rows, and the confirmation dock froze. The operator saw the already-closed question's card still live, and clicking it got a `question-closed` refusal.

The 2026-10-11 case, thread 01a12b12-a3a2-7e2c-b91a-997500c6640b: the `submit_work` question got a `cancel` answer at 13:39:50.052, the card stayed live, and a later "Submit" click gave a red banner. Where the `cancel` came from the server record does not say: the answer carries no surface it was sent from.

Fix: `sync` reads the source revision on every path. Proof is `VisibleFeed.svelte.test.ts`, which failed on the old code.
