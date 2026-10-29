---
id: 01a11bae-35fa-7ce8-ad2e-59da30414380
title: The arrival row carries the same resolved attachments as the landed signal entry
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9123ae16171c
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd5c3436715
---
Review [[ae16171c]] remainder (item 19).

The arrival row `ThreadPendingInput.arrived` (`thread/run/ThreadSnapshots.ts`, `pendingInputOf`) is built from an inbox item that carries only attachment references (`{ id }`). The journaled signal entry carries the resolved attachments (`mime`, `url`, `filename`). So the arrival shows with no attachments until the entry lands and gains them.

Do: the snapshot resolves attachment references through the attachment store exactly as signal journaling does (`threadSignalEvent`). Then arrival and entry carry the same thing.

Proof: a feed pair with an arrival carrying an attachment folds to the same row as the landed entry.
