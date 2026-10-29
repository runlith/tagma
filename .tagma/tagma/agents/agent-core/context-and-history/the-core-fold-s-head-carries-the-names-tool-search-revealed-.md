---
id: 01a17b07-08a6-7ab5-ba17-6dd184b19bb7
title: The core fold's head carries the names tool_search revealed in the folded part, under any summarizer and on any transport
ord: 13
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a17af8-7588-7417-8db8-28c33040f6fa
  - kind: relates
    to: 01a10a1a-ee85-7fd6-b885-d18d92391518
sources:
  - kind: symbol
    ref: packages/agent/src/thread/compaction/projection.ts
    symbol: threadCheckpointHead
---
The next step's tool list — the `deferred-tools` rule at a native run and `offeredBy` at hosted — learns what was revealed only from the thread history (`discoveredToolNames`), and `tool_search` outcomes are gone from it after the fold. So `threadCheckpointHead` places the names revealed in the covered part (`foldedReferences`) into the first entry's `metadata.toolReferences` — the same way the hosted-fold head does with its model (`journal.ts#eventsOf`). A repeat fold covers the earlier head and carries its names onward.

`compaction.toolReferences` does not hold that role: only the provider line with a compaction profile writes it (`lineageOf`), and at a thread with no such profile — Claude Code on ACP compacted by someone else's model, native on a provider without a profile — the head would otherwise come out with no names. The list narrowed to the unrevealed: Claude Code refused the call with "No such tool available" and sent input without a schema, the native door refused with the schema attached.
