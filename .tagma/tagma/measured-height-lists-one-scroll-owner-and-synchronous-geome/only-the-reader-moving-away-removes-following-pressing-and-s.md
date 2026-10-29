---
id: 01a14f4a-f4a6-7342-a011-3a1876fcb7d4
title: Only the reader moving away removes following; pressing and selection only hold the feed, and at the very bottom it follows the tail on any scroll source
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14f41-54fb-791e-a64d-69d20dfea1b6
sources:
  - kind: file
    ref: packages/virtual-list/src/FollowingViewport.svelte.ts
  - kind: symbol
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
    symbol: TranscriptViewport
---
A pause with no end event leaves the reader at the bottom with no following: they see the last line while new ones go down. So every state except moving away upward has an event that ends it.

- **Bottom precedes attribution.** Shrinking content pins `scrollTop` to the new bottom, and that looks like an upward move under the reader's hand. A scroll ending at the very bottom cannot be a move away, so it returns following, whoever made it.
- **Downward motion at the bottom is following.** On a wheel and a downward key at the very bottom Chromium sends no `scroll` (measured on Chromium 1228), so the reader's own intent to go down, while the feed is within the bottom threshold, returns following.
- **Pressing and selection hold, not pause.** While they last, the feed does not scroll on its own, and any shift of it counts as the reader's; on release an unmoved feed returns to the tail. Pressing the feed's own area is indistinguishable from pressing the scrollbar: overlay macOS scrollbars have no width. And dragging the bar gives no `pointermove`, only `pointerdown`, `scroll` and `pointerup` (same measurement), so pressing is the only sign of the reader's hand on the bar.
- **Resizes without scrolling are checked separately.** A shrink after which the new bottom matches the current position, or content fitting the screen whole, gives no `scroll`. So the surface reports every resize of the feed and its content, and a stopped feed that finds itself at the very bottom follows again.
- **The reader's movement is the view moving over the content, not a time window.** Every correction of the feed's owner keeps the row at the top of the view at the same offset into it, so after the owner has handled a scroll event, one whose top row and offset did not move is the owner's; one that moved them is the reader's or the browser's — inertia after the finger lifted (iOS sends no touch event during momentum, and a finger catching a fling sends none either), the scrollbar, key animation, focus, find-in-page, selection autoscroll — unless a select the feed itself started is still travelling. A 250 ms window after the last input expired in the middle of iOS momentum and took the fling for the feed's own move; the owner's moves at the tail land at the bottom, which bottom-first already reads as following.
