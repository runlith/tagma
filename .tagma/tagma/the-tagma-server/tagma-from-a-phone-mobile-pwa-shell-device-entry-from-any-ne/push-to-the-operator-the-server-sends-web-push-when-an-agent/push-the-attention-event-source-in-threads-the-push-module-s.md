---
id: 01a10c46-51dc-7b25-9f6a-c5f0f5eaf5ea
title: "Push: the \"Attention\" event source in threads, the push module, service worker notifications"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10c46-cf41-725f-b8e7-3b8ca5ce8590",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10b84-a61c-7f1c-a4af-cae1c39abc78
  - kind: waits-on
    to: 01a10c46-51dc-7b25-9f6a-c5ed6fee8958
  - kind: waits-on
    to: 01a10c46-51dc-7b25-9f6a-c5ee3db4ab5a
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/pendingAsk.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/summary.ts
---
All of [[c39abc78]]. Waits on device admission and the revocation event from [[6fee8958]] and the shell's service worker from [[3db4ab5a]]. Start with `threads/list/summary.ts` and `threads/list/pendingAsk.ts`; check `web-push` under Bun first.

The failure reason in an "Attention" row is currently sometimes raw JSON — `{"_tag":"Code","code":129}` at an external CLI's stream (mobile Home snapshot, 2026-10-05). It lands in push's body, so it is fixed at the reason's producer, not by trimming in `push`.

Done when the spec's acceptance holds.
