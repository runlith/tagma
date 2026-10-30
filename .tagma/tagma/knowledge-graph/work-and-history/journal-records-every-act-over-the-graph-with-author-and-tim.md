---
id: 01a14bc5-0df5-77c8-b1a2-69423f034f23
title: Journal records every act over the graph with author and time; the operator pages it on the Journal screen
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/journal/Filters.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/journal/Page.svelte
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/journal/rows.ts
    symbol: journalRows
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/journal/Screen.svelte.ts
    symbol: JournalScreen
  - kind: symbol
    ref: apps/tagma/server/src/graph/journal/eventLog.ts
    symbol: journalBatches
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/history.ts
    symbol: HISTORY_PAIRS
---
**Value.** Every act over the graph stays in the journal with author and time. The operator reviews what agents did to knowledge while he was away, and an agent catches up from where it stopped.

**How.** `read_events`, `read_journal`, and `read_journal_vocabulary` for agents; `read_block_log` for commits of the graph tree touching the block's file; `read_thread_work` for one thread's journal across every graph copy, by block. The Journal screen in the app, shared or for one block, and the thread's Work tab.

**Behaviour.**
- Consecutive acts of one author over one block pack into a batch. A departure keeps its former identity and destination separate from the source copy's local history, so restoring that copy never rewrites the departure. On screen rows group by day, a deleted block is struck through.
- A click opens in the diff lens on the row's range; a row that created its block opens the block itself.
- What is new since the last visit is marked. Tag, author, and act filters remember for the project, new entries arrive live.
- Registry and project enforcement acts also land in the journal.

**Limits.** The agent event journal never counts total entries. A block file's history reads only with file graph storage.
