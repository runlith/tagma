---
id: 01a151df-e920-73d7-9b09-09e4d7c40fd9
title: "Thread fork copies no journal: the child references the source prefix"
ord: 19
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/rows/branch.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadBranch.ts
---
**Outcome.** Forking a thread of any size — `branch_thread`, `fork_thread`, spawn with `fork` — answers in time that does not grow with the source journal, and writes to the database and disk only what the child itself writes. To a human and to an agent the child is indistinguishable from a full copy: the same feed, rewind points, attachments and tool outputs, searchable lines, `read_thread` facts. What the source does after the fork — rewind, compaction, output trimming, offload, deletion — does not change what the child sees.

**Before.** Fork copied: source `thread_entry` rows with one `INSERT … SELECT`, a `thread_event` synthesized from them, a hard link per attachment and saved-output file. Copy bytes grew with the source (a 34 MB transcript produced ~57 MB of rows and a 40 MB rollout, one sample), with the writer database held busy all that time.

## Design

- **The child journal is database layers plus its own tail.** `thread_base` stores the child's layers: the thread whose *own* rows are read, the journal position range `(after, through]` and the transcript `ord` range, plus slice filters (hidden runs, removed `system-prompt`, lower `ord` bound for `turns`). `through` is the source head at fork time under any slice. Forking a fork copies the parent's layers and adds a layer for the parent's own rows, so a layer always points at rows of one thread and the chain never unwinds at read time.
- **What distinguishes the child from the prefix is its own events.** If the slice is not `all`, `system-prompt` is removed, open calls are sealed, or the model history differs, the child writes a `branch` event at `through + 1` with a `branched` fact: which prefix records it does not see and which model-history segments are excised. Excision, not replacement, of history: message-to-run attribution (rewind points) stays correct, and runs left with no messages count as removed. The answer to sealed calls is a step event carrying that message; its records are ordinary event records. The child writes model history as its own projection (bytes of the folded history order). The canonical fold (`TranscriptFold`, in-memory store, conformance) removes records by `branched`; the SQL projection skips that fact because the same slice is already in the layer filters. With no differences the child writes only the row, the model history, and cursors.
- **One owner reads the database.** Events are `threads/journal/log.ts` (all journal reads go through own rows and layers), transcript is `native-harness/transcript/layers.ts` (shoulders: own rows first, then layers top-down; a top-layer row at the same `ord` shadows lower ones), conversation index is `conversationReads.ts`. The fork core and the `ThreadAggregateStorage` port are SQL-free: `branch(seed)` answers `{ through, from }`, the in-memory implementation copies events and passes the same conformance.
- **Copy-on-write.** Before a thread mutates a transcript row in place (`replace`, `mark` for rewind/restore, `withdraw`), every child whose layer over that thread covers its `ord` receives what it saw at that `ord` into its own table. The child writes its own edit of an inherited record as a copy into its own table (copy-up); `withdraw` of inherited records hides their run in its layers. New source rows get `ord` outside the children's ranges, so they do not fall into the child's prefix. In-place source events are mutated only by writers that preserve meaning: call-body folding (`stripping`) and its return (`restore` before `replace`, `withdraw` and now `mark`), form steps, bounding (value moves to a file, pointer read through the database), footprints (each child keeps its own latest footprint up to `through`; it would fold the rest itself).
- **Offload and return.** A live layer exists only while both child and source lie in SQL ([[7104243b]]). When the child offloads, the offload pass rewrites its rollout whole together with the prefix and copies it the visible index lines; the layer empties in the same transaction that marks the offload; returning the child is an ordinary return from its file, the source is not returned. When a source with live children offloads, the same pass carries the visible prefix to each live child in portions (transcript, events, index), the layer empties, the child's rollout is rewritten after leaving the source queue; the source offloads with nothing left in SQL. An empty layer holds neither offload nor source rows: it remains for the source's attachment and output folders and leaves with the child. Forking an offloaded source still returns it first.
- **Deletion.** Deleting the source carries its visible part of the prefix into each live child: transcript rows, events (call bodies unfolded) and conversation-index rows (to the first heir; the remaining children are reindexed by the next backfill pass). The layer stays empty of rows, only for files: folders of attachments and outputs of a deleted source are not freed while any layer references them. Deleting the last child frees what the offloaded source left in its journal queue (`ThreadRollouts.freeing` → source offload) so as not to diverge from an in-flight return; folders of the deleted source go on the next `letGo`.
- **Search.** Child search answers matches from its own index and the layer indexes in their position ranges, when the record is visible to the child (its own copy or a layer row passing its filters) — without second indexing. Search without a thread expands each match onto the branches that hear it, so it finds the branch too. The index is also copy-on-write: before the source removes or mutates an index row visible to a child, the child gets its copy.
- **Attachments and saved outputs.** Fork touches no files. Attachment and output reads look in their own folder first, then in the layer folders.
- **Rollout.** A live child's rollout carries only its own tail; the writer opens it at head `through`. Before the child offloads, the rollout is rewritten whole together with the prefix.

The fold overlay was chosen by measurement (bench below): opening the child's feed as a window by `ord`, as the source's, while folding the prefix "as at `through`" from events grows with the journal.

## Acceptance — proven by the implementer

- Forking a synthetic thread of 1 GB of journal answers in the same time as forking a 1 MB thread (sample on one machine, `apps/tagma/server/scripts/bench-thread-fork.ts`), and adds database bytes on the order of the folded model history. The same bench with a source of tens of thousands of attachments and saved outputs vs a few answers in the same time.
- Fork, rewind, spawn and `branch_thread` conformance pass with the same expectations as a copy.
- Per writer on the copy-on-write list — a contract test: after its act over the source prefix the child's feed, rewind points and facts are unchanged (`forkPrefix.itest.ts`).
- Deleting, offloading and returning the source with a live child leave the child readable and unchanged, including saved prefix outputs; deleting the last child frees what was left behind.
- A prefix line is found by `search_threads` in the child.

## Measurement

`bench-thread-fork.ts`, one sample each on an Apple M2 Max (12 cores, 32 GB) under load from other agents, commit `96df013d3a`:

- 1 MB source (176 events / 0.46 MB, 0.54 MB transcript): fork 34 and 17 ms; the child writes 32 history rows (0.19 MB) and one layer.
- ~1 GB source (200,085 events / 336 MB, 672 MB transcript, 40 MB index): fork 262 ms (first, cold) and 35 ms; 72 SQL queries in both sizes; the child writes 170 history rows (1.03 MB), zero events, transcript rows or index rows.
- 2 files vs 29,999 attachments and as many outputs: fork 44/22 ms vs 147/126 ms right after writing 60k files and 29 ms on repeat; fork touches no files, the first runs' gap is disk background.
- Overlay vs folding "as at `through`": a 100-record feed window on a 1 GB source — 16 ms, on the child — 6 and 4 ms; folding the same prefix from events — 36 s.

## Out of scope

Restoring a child from rollout after database loss with prefix materialization is [[a0db1661]]; offloading the child and the source with live children is [[7104243b]].
