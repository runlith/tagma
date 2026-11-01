---
id: 01a19499-b693-7656-8dd8-eb12ac751462
title: Held histories are bounded by resident weight their producers already know; an unweighed history is not held
ord: 68
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a19471-c11f-7184-8092-d9c0a990be94
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/heldHistories.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.ts
  - kind: symbol
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.ts
    symbol: measureMessages
---
`HeldHistories` keeps each thread's folded history and its stored rows, least recently read leaving first, within a bound stated in resident bytes. The bound covers idle threads only: a thread this process drives a run for (`RunControl`, served through `serveDriven`) is never evicted, because its run holds the same messages anyway; evicting it frees nothing and the next reader would parse a second copy, which the run's next write then shares nothing with by identity. A running thread's history is the declared working set, one copy per running thread.

A write's claim keeps the committed history readable: SQLite shows other readers the committed state until the write commits, and `caughtUp` checks the stored cursor, so a reader during the write reads what stood instead of parsing the whole history. A reader may not publish over a claimed entry, which would make the writer's settle refuse. A claim whose unit ends without settling restores the committed entry, unless it was taken over another writer's claim: that writer may have committed since, so the entry is dropped instead. Weight is never measured by serializing a held message: every producer weighs a message where its size is already known — a loaded row and a journal event by their stored text (an event's length shared across the messages it adds), a written message by the bytes `measureMessages` encoded for its digest (`MessageMeasure.bytes`). Resident size is derived from serialized size by a calibration of parsed-message overhead per byte and per message, measured on Bun's JSC over text-heavy and over small messages; a change of runtime or of message shape calls for measuring it again.

A message keeps the first weight it was given: its later measure may count its bytes differently (UTF-8 against string length), and a held sum built from the first weight must subtract the same weight when the message leaves. A history holding a message nobody weighed is not held at all: a cache miss costs one load, an unweighed entry would break the bound unseen. A thread's new history is weighed against the one it replaces by identity — a write's claim carries the replaced history for this — so a step pays for the messages it added or dropped, not for the whole history; the pointer comparison of the shared prefix stays linear, as in the row diff of a write. Stored rows count only past the prefix they share with the folded history. A single idle history larger than the bound is never held. The bound is checked again whenever the number of runs this process drives changes, so histories of runs that just ended leave without waiting for another publication.

`ThreadPruner` keeps its `HistoryIndex` and the request meter keeps its measures in weak maps keyed by message identity, so they live as long as the messages they describe: this bound and the unit-end release of per-unit folds bound them too.
