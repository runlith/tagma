---
id: 01a0c74e-1505-70a8-932e-58689d8ec960
title: The comment door clipped another existing comment mid-sentence, in a second file
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The block above it now ends mid-sentence — \"Which threads the database holds, read once: a row per file would be a round trip per\" — with its continuation line gone, and the prose written for the change was stripped wholesale.",
    "command": "edit on apps/tagma/server/src/harness/ThreadRollouts.ts, changing `replay()` to skip a thread on its eviction stamp instead of on its file's compressed form",
    "expected": "The edit names one condition inside one function. Prose the project's comment law does not allow is refused or removed whole; an existing comment above the query is either left standing or taken entirely."
  }
---
Filed from project `runlith`.

Second sighting, another file, same shape: an edit to one condition left a neighbouring comment cut in half. The first was on `ThreadStore.ts#historyForUpdate`; this one is in `ThreadRollouts.ts#replay`. Both times the writer had to notice the damage in a diff and decide what to do with somebody else's half-sentence, and both times the sentence was true and load-bearing.

What makes it a pattern worth the second record rather than a repeat: neither edit named the comment it damaged, so no review of the change as described would look at it.