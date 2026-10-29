---
id: 01a1258f-7565-71ba-af09-1518ebe254cd
title: "settleIndex failure on a busy index.lock leaves the main checkout index at its pre-commit version forever: the promised retry never comes"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13b1e-324b-7c56-8478-6a22b866aeba",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12582-fbf7-755e-8fd0-98c0a4db449b
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/git/settle.ts
---
`settleIndex` (graph commits `tagma: graph @ N`, preservation) takes `index.lock` in three attempts 100 ms apart; a busy lock (`git status` of any reader, the operator's Git window, an agent shell) yields `IndexBusy`, and `publish` returns it as unsettled. The `IndexBusy` message says settlement "re-enters the commit lane as a settlement-only step", but nothing retries it. The next commit of the same path sees the index differ from the base and leaves it "staged or moved by hand" — the lag stays until removed by hand.

Observed: `serve.log` 2026-10-10 05:27:26 — `IndexBusy` after `tagma: graph @ 242424`, at 05:30:39 the next graph commit left the path. `.tagma/runlith/tagma/enforcement/merge-driver-commit-gate.md` landed among the 12 staged files of task a4db449b.

To do: a path Tagma failed to bring to the published commit because of the lock is brought there later by whoever promises it — a settlement retry after the lock frees (a write equal to the then-base or the published blob, with HEAD still carrying that blob) — and the message names what actually happens. Done when an integration test with a busy `index.lock` during settlement shows a clean `git status` for the path after the lock frees.
