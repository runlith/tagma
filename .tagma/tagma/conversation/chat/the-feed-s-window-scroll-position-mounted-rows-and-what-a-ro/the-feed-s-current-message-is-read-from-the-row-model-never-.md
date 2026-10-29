---
id: 01a1808a-0601-7f7a-a05f-e69d5f44eb38
title: The feed's current message is read from the row model, never from the rendered rows
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
sources:
  - kind: file
    ref: packages/chat-ui/src/transcriptCursor.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
---
The feed is virtualized: only rows near the viewport exist in the DOM. A reading of `[data-message-id]` elements therefore misses the operator's message whose turn the reader is in as soon as that message scrolls out of the rendered window, and it also meets rows that are not his messages (errors, retries, compactions, agent words), which the rail has no tile for. Both left the rail with the wrong tile gold or none.

So the current message is the last operator message whose row index is at or before the row under the reading line, found through the virtualizer's measurements, which cover every row whether rendered or not, at the virtualizer's layout position — the one a held correction already counts. A selection scrolls through the virtualizer's own `scrollToIndex`, which keeps correcting its target while rows above it measure and drops the library's pending anchor work as an explicit command; the window holds the clicked key as its aim and re-aims when rows are inserted above it, since the library's command targets an index, until the reader's own input or a return to the tail ends it. While the aim stands, the feed's movement is the command's, never the reader's. A DOM lookup after one tick found nothing for a row outside the window, returned without pausing the tail, and the next growth pulled the feed back to the bottom.