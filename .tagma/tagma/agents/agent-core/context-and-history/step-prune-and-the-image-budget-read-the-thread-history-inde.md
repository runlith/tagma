---
id: 01a15242-d75f-7978-b03b-2b57167864f9
title: Step prune and the image budget read the thread history index, extended by tail while history continues the same messages by identity
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/historyIndex.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/pruner.ts
---
`ThreadCompaction.prepare` runs on every model step, while the history between steps only grows by tail. So tool-output prune and the image budget are computed not over messages but over a `HistoryIndex`: turn openings, the last assistant response, not-yet-pruned tool results, and live images. `ThreadPruner.index` holds the index in a `WeakMap` keyed by the first history message: a history line lives as long as its messages do, and the index does not hold threads that are gone. The next step compares earlier messages by identity and reads only the new ones; any divergence — prune settlement, compaction, rewind, history reload — rebuilds the index. Each result's cost is counted once, when it enters the index. The comparison only compares references and reads none of the messages or results the thread already saw, so an ordinary step reads and serializes not a single message or result; the comparison itself stays a linear pass over references, because the history owner does not report that it continued the earlier one.

A result already written into history as a pruning line does not enter the index and counts as settled: its mark is written by the same write that writes the line (`pruningSettlement`). Otherwise the result list would grow with the whole history. Unpruned results and live images in the index are bounded by the model window and the provider request limit: everything older is either pruned and written as a line, or folded by compaction.

For the same reason the step meter (`ThreadRequestMeter`) skips the message prefix shared with the previous request and extends the revealed deferred-tool names by tail. `observe` measures the sent request with its own meter: its messages after `lower` are different objects, and a shared meter would reset the estimate prefix on every step.

`ThreadContextAnchor.lower` holds the prepared form keyed by the message line (key — the first message), at most two lines: the same `lower` prepares both the step request and the step response for aside capture, and one shared entry would evict the request with the response on every step. The prepared form is held together with the source while the source stands fully paired (call and its result side by side): then the prepared form matches the source by position, and the next step, whose tail is likewise paired, runs only the tail through `projectMessages` and `hydrate` — each handles one message. An unpaired tail or a source divergence takes the full pass with `pairedForProvider`: pairing recovery gathers results across the whole history. The prepared form holds loaded images until the run ends; their volume is bounded by the provider request limit.
