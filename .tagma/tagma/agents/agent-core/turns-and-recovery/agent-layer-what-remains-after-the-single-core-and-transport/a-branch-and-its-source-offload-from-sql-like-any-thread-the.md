---
id: 01a15283-4e5a-755f-a5b4-ad8a7104243b
title: "A branch and its source offload from SQL like any thread: the prefix materializes for the branch as soon as one side offloads"
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-567a-72f4-83ce-3134e2c0b824",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09e500898729
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
  - kind: relates
    to: 01a12699-1673-714b-a6a5-79efc3af42eb
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/base.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rest.ts
---
After fork-without-copy ([[d7c40fd9]]) a branch with a database did not offload into a rollout, and an offloaded source with live children held in SQL every row the children need. A restored branch and a branch of a deleted source also held empty layers and did not offload. Agents fork often: spawn with `fork` carries the whole parent history. Branch journals and their sources, archives included, stayed in the database forever — a rollback of the [[c3af42eb]] goal.

Invariant: a live layer exists only while the branch and the source both lie in SQL. When one side offloads, the same offload pass, in portions and in the offloading thread's journal queue, materializes the prefix for the branch:
- the branch offloads — its rollout is rewritten whole together with the prefix, the visible index lines are copied to it, the layer empties in the same transaction that marks the offload; the branch returns from its file and does not return the source;
- a source with live branches offloads — each gets the prefix into its own rows, the layer empties, the branch rollout is rewritten after leaving the source queue; the source offloads with nothing left.

An empty layer holds neither offload nor source rows; it remains as a path to the source's attachment and output folders (their deletion of the source does not free them while a layer references them) and leaves with the branch. Price is a copy of the prefix in each offloaded branch's file and index; a file layer reading an offloaded source was rejected: it would need a second reader of transcript, events and index over files.

Measurement (`bench-thread-fork.ts --turns=18200 --rest`, one sample, Apple M2 Max 12 cores 32 GB, load average ~5, commit `7fd509dfb8`): a source of 182,085 events (306 MB) and 182,000 transcript rows (612 MB) with two live branches offloads in 137.6 s; 2306 writer transactions, the longest 80 ms, sum 63 s. Each branch gets 306 MB of events and 612 MB of transcript. On disk 645 MB became 1.91 GB: two branch rollouts of 646 MB each, the compressed source rollout 7.5 MB and the source `.entries` projection 615 MB. Before the file projection was portioned in SQL the same pass held the writer 12.7 s with one `ThreadProjection.run` transaction.

Proof: an integration test — a branch and a source after offload hold no journal rows in SQL; the branch feed, rewind points and search equal the former ones; returning the branch does not return the source; a source offloaded under a live branch hands it the prefix, and the branch reads as before. Measurement: a ~1 GB source and two live branches — pass time, longest portion under the writer, bytes on disk, one sample.
