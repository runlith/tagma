---
id: 01a0ca87-e895-7ce5-b1f9-6f2cfe4c5399
title: "The pin's mark comparison never disagrees: every increment pairs with a clear"
ord: 75
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
resolvePinnedMessageId answers the pin only when pinnedMark equals scrollMark (packages/chat-ui/src/transcriptMessageNavigation.ts:1-8), but every scrollMark increment pairs with a clearPinned in the same handler (packages/chat-ui/src/TranscriptViewport.svelte.ts:302-303), which re-syncs the marks while dropping the pin — so the inequality branch, with a pin set and marks differed, is unreachable. Decide whether the mark comparison is intentional defense (then say what it defends) or a leftover of an older clearing road, and simplify or document it.