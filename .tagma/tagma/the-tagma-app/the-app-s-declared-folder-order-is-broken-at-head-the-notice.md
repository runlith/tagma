---
id: 01a0ca95-313b-7d81-b8e4-35127ea49bec
title: "The app's declared folder order is broken at HEAD: the notices folder imports the accounts folder"
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cabe-17dd-7be2-91ad-9d1e1a516efb",
    "status": "done"
  }
---
`apps/tagma/app/src/lib/layout.test.ts` declares the one-way folder order of `lib` and is the only thing that enforces it. It fails at HEAD with two faults, both from one file:

```
features/notices/NoticeCards.svelte (notices) imports $lib/features/accounts/gauge.js (accounts), which stands later in the order
features/notices/NoticeCards.svelte (notices) imports $lib/features/accounts/UsageGaugeForm.svelte.js (accounts), which stands later in the order
```

Committed, not working-tree: `git diff HEAD` over both directories is empty, and the import arrived in `d0ed719f76` on 2026-09-19. The notices column takes `STATUS_BAR_HEIGHT` and the gauge-form store from the accounts folder so that a card clears the status bar and matches the gauge the reader chose.

Either direction is a real fix and this task is to decide which and do it: move what the notices column needs down the order — the status bar's own height is a frame or shared fact rather than an accounts one — or move `notices` after `accounts` in the declared order if nothing else forbids it. Do not disable the test, and do not widen the order to permit the import without moving anything.

Found while cutting this module for [[a014cd4c]]; it implements no decision of its own. Done when the suite is green with the order still one-way and the reason for the direction chosen recorded on [[e3e9376a]] or beside it.