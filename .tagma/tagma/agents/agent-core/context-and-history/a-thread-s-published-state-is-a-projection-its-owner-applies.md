---
id: 01a190e8-4cc1-7d06-8ccf-bdeb546133ca
title: A thread's published state is a projection its owner applies committed changes to, reading storage only when a change does not follow the published position
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
`ThreadSnapshots` keeps each thread's last published state with the inputs its status was derived from (input receipts, open questions, the newest ending), at most 256 threads, the least recently changed leaving first. Every change to that projection runs on one drain per thread, in the order it was asked: a typed change a commit hands over, a read a producer asks for with `publish`, a status deadline. A frame is therefore never published from a state older than one already sent, and `snapshot`/`attachFrom` cut against the same `atCut` the drain takes.

A kernel transition whose plan names `published` and that opened its own unit hands its change from the unit's after-commit tail, which runs inside the thread's journal lane in commit order: the journal facts it appended (in journal form, positions included) and the `native_thread` columns it stamped. The kernel itself stamps `updatedAt` for the fold write, so the change carries the exact value. A transition whose participants may write projected state, whose patch touches more than the context reading or the pending interaction, or whose record is an input receipt, an envelope or an owned record hands `moved` instead, and the drain reads the thread.

The drain applies a change without reading storage only when the change starts at the position last published, a run is active and not awaiting an answer, and its facts are plain entries: the status is then re-derived in memory from the held inputs, the launch gate and the transport's words wait, and the host's own parts of the state carry over from the lane's last frame (`ThreadFeed.carry`). Anything else reads the thread whole, and that read covers every change queued before it; a change whose position a read already passed is skipped. A journal append no change announced shows as a gap in positions and is read.

Journal position alone does not prove the held inputs fresh: writes outside the journal change them without moving the position. Until the change revision (spec A's first clock) orders them, each such writer either publishes or drops the held projection, and the next change reads the thread whole. The run beater announces each landed heartbeat through `RunControl.onBeaten` and so drops the projections of the threads it beat; a read in flight when that happens does not install its result. A setting the host projection reads (machine delegation, sub-agent depth, compaction limits, the default account) republishes every followed thread, running ones included, because a carried frame repeats the host's parts of the last frame.

The applied cut is shared with `snapshot`/`attachFrom`: a cut that reads past the published position records how far it saw, and a queued change starting before that is read whole instead of carried, so no frame after the opening frame shows an older state. The queue holds at most 64 changes per thread; past that, the backlog collapses into one whole read.

Why: every publication re-read the thread — metadata, runs, inbox, receipts, questions, ending — and the host projection (title, place, delegation, approving, depth, pins), about 25 statements, for an append whose facts the writer already held. One sample, the hosted-cost itest on one machine: a hosted `read` fell from 50 publication statements to 0. The heartbeat re-read costs one whole read per active thread per heartbeat interval, on the next change after the beat.
