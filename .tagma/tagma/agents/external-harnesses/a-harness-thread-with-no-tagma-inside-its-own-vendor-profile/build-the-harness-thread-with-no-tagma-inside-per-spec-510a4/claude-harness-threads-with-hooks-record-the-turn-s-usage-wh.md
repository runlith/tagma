---
id: 01a14214-0718-7ed8-ac68-5e48f8ea396d
title: Claude harness threads with hooks record the turn's usage when the Stop hook closes the turn
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14dd1-43cd-7723-af0a-5cf815955c6a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a141bd-1de3-79e9-903b-8de5136ee86c
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/events.ts
---
A terminal Claude turn records usage only when the watch closes the turn on the transcript: `TerminalWatch.check` → `reports.ended(run, ending, spent)` (commits 54342e1dfd, 7274c12cef). A plain thread only closes that way.

On a thread with hooks the turn usually closes `TerminalEvents` (`turn-end`/Stop): `reports.ended(run, ending)` goes without usage and drops `turn`, after which the watch never records the spend.

Do this: when a hook closes the turn, read the turn's spend with the same `readHarnessTranscript` from `turn.offset` and `spentSince(…, openedAt)`. The read sits outside the `store.change` transaction, as in the watch. An incomplete or failed read records nothing and logs a warning.

Proof: a stest on a thread with hooks where a Stop leaves the turn's usage on the run.
