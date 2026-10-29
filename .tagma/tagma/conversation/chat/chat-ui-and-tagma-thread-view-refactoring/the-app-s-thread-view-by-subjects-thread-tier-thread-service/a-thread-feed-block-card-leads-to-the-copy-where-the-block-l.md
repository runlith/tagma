---
id: 01a14661-fb47-7f7a-a277-5bb087204504
title: A thread-feed block card leads to the copy where the block lies, not the thread's project
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14654-6702-7cdd-b478-26b750007351",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a11b65-f219-70d5-8e2c-66aac7c0b002
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/BlockCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ToolBlockDiff.svelte
---
`BlockCard` built the link from the thread's `GraphRung`, while `ToolBlockDiff` read the diff through the thread's door. A block written or read in another project (a reflection from a <project> thread landing in the runlith graph) opened with someone else's project and fell `place-mismatch`, while its diff silently never showed.

Make: the card and its diff take the address from `BlockTitles` (`read_titles`), like any block link; the diff reads in the found copy, links inside the diff in the same copy.

Check: `BlockCard.svelte.test.ts` — another project's block card leads to its project; app typecheck.
