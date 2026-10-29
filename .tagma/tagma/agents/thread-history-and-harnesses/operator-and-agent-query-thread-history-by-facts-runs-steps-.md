---
id: 01a14be4-2437-75af-92bd-b427b7bf6486
title: "Operator and agent query thread history by facts: runs, steps, spend, time, records"
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/cli/threadVerbs.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
    symbol: THREAD_OPERATIONS
---
**Value.** How the thread went — what it cost, where it got stuck, what each run did — is learned by query, not by scrolling the feed.

**How.** The `list_threads`, `read_thread`, and `read_thread_record` operations; the `tagma thread` CLI.

**Behaviour.** Threads are selected by title, spawning lineage, timestamps, and what their runs did; a row names the thread's model and the last run's model. A thread answers what it is — the saved prompt, runs with model, spend, and time, the session's graph acts — or a facts query with selection, grouping, and sums. Pages continue a frozen question with one cursor, without repeating the selection; new records do not widen an already open read. An addressed record opens whole.

**Limits.** An agent reads another's thread under the thread-read right. The feed and transcript themselves are the conversation area (A2).
