---
id: 01a1a7aa-afcc-7f7c-80e5-e85b6c2d6571
title: "A send keeps the feed on its tail: only the reader's input takes it off while it rides the tail"
ord: 89
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a77b-c926-788f-a7e3-e7aa453db1cf",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
  - kind: relates
    to: 01a14f4a-f4a6-7342-a011-3a1876fcb7d4
sources:
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
  - kind: file
    ref: packages/virtual-list/src/FollowingViewport.svelte.ts
---
A send from history sometimes left the feed off the tail: it reached the tail, then stopped following while the run wrote below. In Chromium on the stand the tail write read back 1020 px short, because rows at the tail measured taller before its scroll event, and `TranscriptVirtualizer.moved()` counted the library's own write as the reader's movement; `FollowingViewport` paused and the pause cancelled the tail command. A second path: an end-keeping correction, which keeps the distance it finds and moves the top row, was counted as the reader moving up. A third: a selection standing in the answer being written re-took its hold on the next `selectionchange` after the send.

Do: while the feed rides the tail, no scroll event is the reader's, and one that leaves it short of the end re-aims it; the reader leaves the tail only by input — wheel, touch, keys with any modifier, a press on the scroller, a selection, a Tab that moves focus out of view, the rail. A scroller release judges a movement not yet reported as the reader's. A return to the tail ends the hold of the selection standing in the document until that selection collapses, leaves the feed, or the reader presses a pointer or key in it.

Proof: unit tests through `TranscriptViewport` for growth before the tail write's read-back, a standing selection (synced or still queued at the send) and a scroller release before its scroll event, each red before the fix; the stand's submission e2e in Chromium and WebKit with a send from history while the run streams, a long prompt, a dictated send with the live answer selected, a Shift+Tab walk to a control above the view (red in Chromium while the check ran at `focusin` only), and the formerly intermittent direct send repeated.
