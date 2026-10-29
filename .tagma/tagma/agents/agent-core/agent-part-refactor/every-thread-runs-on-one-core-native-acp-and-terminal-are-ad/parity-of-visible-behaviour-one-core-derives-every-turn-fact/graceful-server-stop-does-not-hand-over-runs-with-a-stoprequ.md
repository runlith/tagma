---
id: 01a14e38-b0a3-73f8-a01c-3961e47cdfcd
title: "Graceful server stop does not hand over runs with a stopRequest: only the next server's reaper stops them after takeoverAfterMs"
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01f6-7d00-af4d-7f2b2b1aecb7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14e05-7134-77c7-93bb-3af5a556dc51
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/runs/reaping.ts
---
Parity-launch measurement (work a556dc51): on a graceful server stop a run carrying a `stopRequest` is excluded from the handover (`handOverRuns … isNull(stopRequest)`). The next server does not pick it up at once but waits `takeoverAfterMs` for the reaper to stop the run; in the measurement about a minute. All that time the thread's words and the next turn wait. No reason for the exclusion is recorded anywhere.

Find why the exclusion stands (commit history, who relies on a stopped run not being handed over). If there is no reason, hand over such runs too, so the new owner finishes the stop at once — for native and the adapter alike; if there is, record it at its owner and shorten the wait another way. Proof: a restart test where a run with `stopRequest` ends after a graceful stop without waiting for `takeoverAfterMs`, and the next turn opens.

## Outcome (248cddaf56, bdf33f20ad)

The exclusion had no reason: 6c27f67612 added it ("preserve requested stops") with no recorded motive. A standing stop is honoured anyway: `ThreadRunReaper.decide` ends any candidate with a stop before adopt, and `adoptRun` takes no such row. The exclusion is removed in both stores (`handOverRuns`). One test relied on it (`continues.ts`) — it checked `handedOverAt: null` on a stopped run; its content (the run stays stopped, nobody picks it up) is preserved. The `handover` contract row in [[7e9130bd]] is completed.

Proven:
- the store contract on both adapters: the departing owner hands over a live row with a stop, the new owner sees it at once with that stop — red with the old filter on InMemory and SQLite, green after;
- a native restart: a run with a stop after a graceful stop ends `aborted` `settledBy: reader` on the new server without waiting for `takeoverAfterMs` (60 s in the test), and the next turn opens. Red with the old filter on InMemory only: on SQLite a native run already ends on departure (`RunLifecycle.broke` with a departing owner and a standing stop).

Not proven: the adapter run is proven only by the store contract. The vendor turn after such a stop is not cancelled by ACP until words arrive — [[1f3cc08a]].
