---
id: 01a190e8-4cc1-7d06-8ccf-bdeb546133ca
title: A thread's published state is a projection its owner applies committed changes to on an unbroken change-revision chain, reading storage only when the chain or the journal position breaks
ord: 18
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1516d-12ce-72ee-9660-45cb7686017c
  - kind: relates
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
  - kind: symbol
    ref: packages/agent/src/thread/transition/kernel.ts
    symbol: applyPrepared
---
`ThreadSnapshots` keeps each thread's last published state at the change revision it was read or applied at, with the inputs its status was derived from (input receipts, open questions, the newest ending), at most 256 threads, the least recently changed leaving first. Every change to that projection runs on one drain per thread, in the order it was asked: a typed change a commit hands over, a read a producer asks for with `publish`, a status deadline. A frame is therefore never published from a state older than one already sent.

**The change revision** is the thread's first clock (`native_thread_rev.change_rev`). A trigger on every table the projected state or the host's parts of it read advances it on each row written: `native_thread`, `thread`, `thread_mandate`, `thread_run`, `thread_event`, `thread_entry`, `thread_inbox`, `thread_call`, `external_session` and `thread_view_pin`. A heartbeat, a usage charge or another process's write therefore moves it without any typed change. Memory storage counts its committed write units instead, a coarser clock that is still exact for the projection. A whole read takes the revision first, so a write landing during the read leaves the held revision older than what it read, and the next change reads again.

A kernel transition whose plan names `published` and that opened its own unit brackets the unit: `opened` copies the revision before its first append, and `revised` advances it once more after its last write, returning both after the commit. That tail runs inside the thread's journal lane in commit order and hands the change: the revision span, the journal facts it appended (in journal form, positions included) and the `native_thread` columns it stamped. The kernel itself stamps `updatedAt` for the fold write, so the change carries the exact value. A transition whose participants may write projected state, whose patch touches more than the context reading or the pending interaction, or whose record is an input receipt, an envelope or an owned record hands `moved` instead, and the drain reads the thread.

The drain applies a change without reading storage only when its span starts at the held revision and its facts start at the position last published, a run is active and not awaiting an answer, and its facts are plain entries. The status is then re-derived in memory from the held inputs, the launch gate and the transport's words wait, and the host's own parts of the state carry over from the lane's last frame (`ThreadFeed.carry`). Anything else reads the thread whole, and that read covers every change queued before it; a change whose span ends at or before the last framed revision is skipped. The position check stays because an offloaded journal appends outside SQL.

A run heartbeat is a typed change of its own. `RunLifecycle.beat` writes the going runs in one unit, bracketed for every beaten thread, and hands each thread a `ran` change through `ThreadChanges.deliver`, the projection owner's intake below it in the layer graph. The change carries the runs' `heartbeatAt` and `updatedAt`; the store stamps both with the beat's own time, so they match the stored values. On an unbroken chain the drain patches the held run and re-derives the status in memory. It publishes a frame only when the status class flips, as heartbeats never published on their own.

A setting the host projection reads (machine delegation, sub-agent depth, compaction limits, the default account) is no per-thread row, so it republishes every followed thread, running ones included.

The applied cut is shared with `snapshot`/`attachFrom`: a cut records the revision it read, and a queued change starting before it is read whole instead of carried, so no frame after the opening frame shows an older state. The queue holds at most 64 changes per thread; past that, the backlog collapses into one whole read.

Why: every publication re-read the thread — metadata, runs, inbox, receipts, questions, ending — and the host projection (title, place, delegation, approving, depth, pins), about 25 statements, for an append whose facts the writer already held. One sample, the hosted-cost itest on one machine: a hosted `read` fell from 50 publication statements to 0; the bracket adds two statements to each delivering program. A write no typed change describes still costs one whole read on the next change, until its producer hands a typed change of its own.
