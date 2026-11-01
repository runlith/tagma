---
id: 01a190e8-4cc1-7d06-8ccf-bdeb546133ca
title: Thread snapshots apply supported committed changes at an exact revision and journal cut
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
  - kind: file
    ref: packages/agent/src/thread/run/RunProgress.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
---
`ThreadSnapshots` keeps each thread's last published state at the change revision it was read or applied at, with the inputs its status was derived from (input receipts, open questions, the newest ending), at most 256 threads, the least recently changed leaving first. Typed committed changes run on one drain per thread. Explicit `publish` calls and publications asked by status deadlines enter the same per-thread snapshot lane; they do not enter that drain. The lane and the framed and opening revision marks prevent a frame older than one already sent.

**The change revision** is the thread's first clock (`native_thread_rev.change_rev`). A trigger on every table the projected state or the host's parts of it read advances it on each row written: `native_thread`, `thread`, `thread_mandate`, `thread_run`, `thread_event`, `thread_entry`, `thread_inbox`, `thread_call`, `external_session` and `thread_view_pin`. A write for which its producer supplies no typed change still advances that clock. Memory storage counts its committed write units instead, a coarser clock that is still exact for the projection. A whole read takes the revision first, so a write landing during the read leaves the held revision older than what it read, and the next change reads again.

A kernel transition whose plan names `published` and that opened its own unit brackets the unit: `opened` copies the revision before its first append, and `revised` advances it once more after its last write, returning both after the commit. That tail runs inside the thread's journal lane in commit order and hands the change: the revision span, the journal facts it appended (in journal form, positions included) and the `native_thread` columns it stamped. The kernel itself stamps `updatedAt` for the fold write, so the change carries the exact value. A transition whose participants may write projected state, whose patch touches more than the context reading or the pending interaction, or whose record is an input receipt, an envelope or an owned record hands `moved` instead, and the drain reads the thread.

The drain applies a change without reading storage only when its span starts at the held revision and its facts start at the position last published, a run is active and not awaiting an answer, and its facts are plain entries. The status is then re-derived in memory from the held inputs, the launch gate and the transport's words wait, and the host's own parts of the state carry over from the lane's last frame (`ThreadFeed.carry`). Anything else reads the thread whole, and that read covers every change queued before it; a change whose span ends at or before the last framed revision is skipped. The position check stays because an offloaded journal appends outside SQL.

A run heartbeat is a typed change of its own. `RunLifecycle.beat` submits the revision bracket and owned-run updates as one store program, with an interactive unit fallback when the adapter cannot plan it or the program conflicts. Its stop requests and each thread's `ran` change reach the owner after commit through the program's ordered tails; no revision read holds the writer. `ThreadChanges.deliver` is the projection owner's intake below it in the layer graph. The change carries only run facts the heartbeat owner actually wrote, including `heartbeatAt` and `updatedAt` returned by the store; ended or foreign-owned candidates never become heartbeat facts. On an unbroken chain the drain patches the held run and re-derives the status in memory. It publishes a frame only when the status class flips, as heartbeats never published on their own.

A unit that joins several writers collects one typed change. The owner of the unit claims it for a thread (`ThreadChanges.claim`, after `opened`), and each writer inside notes what it wrote: the kernel's joined transitions their journal facts and shown columns, `RunReports` the stream tail it saved (tail, heartbeat, `updatedAt`, `resumes`). A phase write contributes the run owner's complete committed progress and stamp: its merge preserves the stored stage and halt, which the phase input alone cannot describe. Standalone phase flushes use the heartbeat's revision-bracketed collector unit. The delayed flush uses the progress owner's construction context while carrying the causing act's cost; it cannot inherit the caller's unit, which may end before the timer fires. Overlapping run patches enter the collector through ordered commit tails, so a later tail write retains its final stamp. A writer whose effect the change cannot carry notes the unit unseen, such as a facet the step changed. `revised` then settles the claim into one `appended` or `ran` change, or `moved` once any part was unseen or the facts were not contiguous. An ACP saved step claims its unit only when it writes journal facts and nothing beyond them and the tail: no fates, ends, starts, measurements, retries, reports, trims, asides or compaction. Such a step hands its change instead of publishing; every other step still publishes whole.

A setting the host projection reads (machine delegation, sub-agent depth, compaction limits, the default account) is no per-thread row, so it republishes every followed thread, running ones included.

The opening cut is shared with `snapshot`/`attachFrom`: it records the revision it read, and an append based before that mark cannot carry a frame. A whole publication reads the thread again before publishing, so no frame after the opening frame shows an older state. The queue holds at most 64 changes per thread; past that, the backlog collapses into one whole read.

Why: every publication re-read the thread — metadata, runs, inbox, receipts, questions, ending — and the host projection (title, place, delegation, approving, depth, pins), about 25 statements, for an append whose facts the writer already held. One sample, the hosted-cost itest on one machine: a hosted `read` fell from 50 publication statements to 0; the bracket adds two statements to each delivering program. A write no typed change describes still costs one whole read on the next change, until its producer hands a typed change of its own.
