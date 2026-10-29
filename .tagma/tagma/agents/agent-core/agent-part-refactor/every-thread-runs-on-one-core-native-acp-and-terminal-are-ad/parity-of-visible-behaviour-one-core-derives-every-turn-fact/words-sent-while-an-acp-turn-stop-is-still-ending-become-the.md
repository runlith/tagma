---
id: 01a14e05-7134-77c7-93bb-3af5a556dc51
title: Words sent while an ACP turn stop is still ending become the dying turn's steer and never return to the queue after its end
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01b6-73d1-ab67-0e20a204ca15",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14d27-43b7-7f10-8069-125e71bd222c
sources:
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/RunScheduler.ts
---
Noticed while debugging 71bd222c on the protocolStops stand: the run is still `running` with a `stopRequest`, the reader sends words — they become a steer of the dying run, the run ends `aborted`, but the words stay in `steers` and never return to the queue; the next turn never gets them. It showed because the core owner on the stand outlives a driver restart; whether it is a product defect is unconfirmed.

Native on a stop with steers writes "Interrupted to deliver N steers" and hands them to the next run. First a test on scripted ACP without a restart (and with one), comparing against native in parity.stest; if words are lost — fix at the owner that accepts a steer into a stopped run or lands unread steers at the end. Proof: the parity scenario "words during a waiting stop" identical on both roads.

## Outcome

Commits 6f5f5fa75f, 371ca2d48b. Without a restart the roads match: words become a steer, the "Interrupted to deliver 1 steer" row, the next turn gets them. A server crash during a still-ending ACP stop diverges: the reaper ends a turn no new server owns, while the words handed to it stayed in `WordsInFlight` forever, and the follow-up waited for their fate. Fix: the follow-up drops from accounting the words of a finished turn no transport holds; the ACP driver holds the turn until the answer to its steer arrives (otherwise words would drop before a late answer). Tests: parity "words sent while a stop is still ending…" (both roads), "…when its server crashed reach the next run" (red without the fix), protocolWords "…answers after the run settled" (red without holding the turn).

Open: after a crash ACP has no interruption row and no partial answer — open text never becomes durable ([[d2cbdb5d]]); a stop waiting on a stopRequest is not handed over on clean shutdown and waits for takeover.
