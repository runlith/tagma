---
id: 01a0d087-7f59-7477-9451-c337ee786d3b
title: An end request accepted behind queued turns while no run holds the thread is hidden from the pending rows and refuses take-back until something opens a run
ord: 126
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d007-1990-76c4-a3c6-b71f65164438
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadAggregate.ts
    symbol: compactRoad
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
    symbol: pendingInputOf
---
Found in review of [[65164438]]. The idle branch (now `ask` in `ThreadCompactionRuns.ts:519-532`, `requestBehind` at :526) sends an `end` request behind when the latest run completed or failed and openers stand queued ahead — the window before the settle's follow-up opens them. If that follow-up already passed or failed, nothing drives the queue, `pendingInputOf` answers empty lists because no run holds the thread (`ThreadSnapshots.ts:145`, `runId === null`), and `unqueue` refuses because `holdingRun` is null — so the accepted request is invisible and cannot be taken back. Turns queued in the same state share the blindness, so the question is the core's: whether that state can persist, and if so whether the holding rule or the follow-up is what changes. Start at `ThreadCompactionRuns.ts#ask`, `ThreadRunInbox.ts#requestBehind`, `ThreadSnapshots.ts#pendingInputOf`, `ThreadAggregate.ts#holdingRun`, `followUpAfterSettle`. Done when a test drives the persisting state or proves it cannot arise.