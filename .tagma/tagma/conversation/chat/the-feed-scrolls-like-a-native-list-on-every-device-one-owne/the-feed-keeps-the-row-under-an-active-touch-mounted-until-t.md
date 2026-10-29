---
id: 01a18497-23bf-7776-b611-f42fa562c8cb
title: The feed keeps the row under an active touch mounted until that touch ends
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1841e-1fea-7ed7-8c31-16b85ac77b5b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18353-fb8c-7866-916b-78b406aa5d8d
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: packages/chat-ui/src/keptRows.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
---
A touch event keeps targeting the node it started on. When the window evicts that row, touchend fires on a detached node and never reaches the scroller. On iOS this leaves virtual-core's gesture (listening on the scroller) in phase `down`, so `_canWriteScroll` stays false and every correction is held until the next completed touch. TranscriptViewport's touch state is stranded the same way. The stand proved eviction under a long synthesized contact (run79382: Win32 fling-touch, row entry-09998 evicted at 1689 ms, its touchend received only on the detached LI). A real finger can drag a row past the window margin when the scroller is short, for example with the keyboard open.

Fix at the window: on touchstart, add the touched row's key to the rows kept past the window; drop it on touchend or touchcancel. The kept row stays connected, so the end event bubbles to the scroller as usual. Proof: the stand's Win32 and iOS-branch fling-touch scenarios see a trusted touchend on the scroller, and the touched row stays connected until it does.