---
id: 01a15726-89f5-7397-bf77-7f2a002ca20f
title: A file moved by command (git mv, mv, cp -p) takes its record moment from ctime instead of going to overlap over the whole window
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1571d-b93e-771f-a678-9f214b49fb0a",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a116e8-e341-7861-a5f6-564c65835438
sources:
  - kind: file
    ref: packages/agent-tools/src/checkoutState.ts
  - kind: file
    ref: packages/agent-tools/src/ShellRun.ts
  - kind: file
    ref: packages/files/src/working.ts
---
`rename` keeps the file's mtime, so `ShellRun.movesOf` finds no write moment at the move destination (`written: null`), and the `Lives.decider` judges it over the whole command window. Any live command of another thread in that window (usually `bun test` or typecheck) turns the shift into `overlap`, and "writers beat readers" never fires without an exact moment. The source deletion also lands in `overlap`, so `pairingOf` never assembles the pair, and the whole move stays nobody's. Observed 2026-10-20: a `git mv` of 11 files by thread 01a125fe left 22 paths nobody's.

Fix at the producer: the write moment of an existing file comes from mtime when it falls in the window, otherwise from ctime when that falls in the window (rename, `cp -p` and `touch -r` set ctime to the operation moment — verified on APFS). ctime arrives in the same lstat as today: `Working`/`Seen` carry it with no extra system call.

Proof along the owner chain: `bash.itest.ts` — the `git mv` destination receives a write point equal to its ctime; the point decision and move pairing are already proven at their owners (`lives.test.ts`, `recordedMoves.itest.ts`: a move whose deletion fell into overlap with a neighbour lands whole on a bare `submit_work`).
