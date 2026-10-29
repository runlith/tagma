---
id: 01a10284-da13-7e0c-9742-a4318dd9eca9
title: Live delivery, recorder, and replay hold the unconfirmed tail
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a102a0-ea9d-7680-8a9d-2512e74ab22a",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/feeds.ts
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
  - kind: file
    ref: packages/agent/src/agent/testing/recording.ts
  - kind: file
    ref: packages/agent/src/thread/run/liveHeap.bench.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadLiveFeed.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStreamRecorder.ts
---
**Boundary.** Limit the output-event retention in live delivery, recorder, and replay to the unconfirmed tail, including unfinished tool calls. The recorder stays lossless; a lagging viewer recovers from the durable transcript with no losses or doubles. `AgentTurn.steps`, `AgentRunOutput.steps`, `AgentRunState`, and the model history memory are outside this task. Packet rate and coalescing do not change.

**Cause.** Auditing [[5610ee2b|K11]] found output replay and compacted live replay holding the whole run, and every server subscription an unbounded queue plus a separate buffer during a snapshot. An isolated `liveHeap.bench.ts`, 128/256 turns, 256 KiB tool output and 100 ~1 KiB text deltas per turn, three cold processes with GC: replay 48.43/96.63 MB; live feed 47.97/95.80 MB. Owners measured separately: those numbers do not sum into one run's heap and do not explain the server's former RSS peaks.

**Implementation.** `92572649b1` caps a subscription at 200 pending events and switches overflow to resnapshot; this is an event-count boundary, not a byte one. `de483199be` replaces the whole output replay with a mandatory sequential `AgentSink`: recorder first, then live. The product's full history recovers from the transcript. `01f2397d72` frees the committed prefix only after a successful COMMIT, moves replay inside the agreed snapshot/resume cut, and frees completed records' recorder accumulators. Pending calls keep only their own call/approval/question/latest-display events. The producer closes open parts before the next model turn, including a successful answer with an unfinished tool input. The snapshot holds no machine writer; on a changed durable head it re-reads once, releasing the cut between attempts, then answers a typed failure instead of waiting unboundedly.

**Owner measurements.** `liveHeap.bench.ts --live --committed`, direct ACK of every turn except the last: 128 turns — 0.553–0.554 MB, 256 — 0.832 MB, over three cold processes; extra 512/1024 — 0.564/0.570 MB. In all cases five events of one tail remain instead of the baseline's 640/1280. This is a feed-owner bench, not a heap of an integrated recorder or server. `snapshotFeed.bench.ts`, three repeats with a stopped consumer and 1000-character events: 25k events — 28.52–28.55 → 0.229–0.236 MB, 50k — 57.10–57.11 → 0.231–0.250 MB.

**Beyond the boundary.** An extra `liveHeap.bench.ts --steps` with a real AgentRunner measured 13.63/27.96 MB of result retention over model history on 128/256 turns; without `text/reasoningText` — 0.114/0.221 MB. A tool-only control found no megabyte-scale standalone copies; kept fields and references add a small increment. Full conditions live in that [[9764395d|AgentStep text-retention task]].

**Done when.** Confirmed output events free independently of finished-turn count and viewer lag; pending calls and the current unfinished turn stay recoverable. Owner tests confirm rollback without eviction, recorder → live order, immutable replay, the agreed cut, and overflow/resnapshot with no losses or doubles; real SQL contracts and direct consumers' typechecks pass. The same isolated workload confirms no feed replay growth with run history. Live captures, a server restart, and a bounded whole-run memory claim are not needed for acceptance.
