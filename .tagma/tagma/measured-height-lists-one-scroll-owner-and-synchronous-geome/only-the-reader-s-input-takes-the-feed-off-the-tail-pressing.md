---
id: 01a14f4a-f4a6-7342-a011-3a1876fcb7d4
title: Only the reader's input takes the feed off the tail; pressing, selection and keyboard focus only hold it, and at the very bottom it follows the tail on any scroll source
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

- **Riding the tail, no scroll event is the reader's.** While the feed follows and nothing holds it, only the reader's input takes it off the tail — a wheel, a touch, a key, a press on the scroller, a selection, keyboard focus, the rail — and a scroll event that finds it short of the end sends it back there. A scroll event cannot tell the feed's own writes from anyone else's: the library's tail write reads back short when rows measured after the write moved the end, an end-keeping correction keeps whatever distance it found and moves the top row, and either one, read as the reader's, took the feed off the tail right after a send. The cost: a find-in-page jump or a screen reader's scroll while the feed rides the tail is undone by it.
- **Bottom precedes attribution.** Shrinking content pins `scrollTop` to the new bottom, and that looks like an upward move under the reader's hand. A scroll ending at the very bottom cannot be a move away, so it returns following, whoever made it.
- **Downward motion at the bottom is following.** On a wheel and a downward key at the very bottom Chromium sends no `scroll` (measured on Chromium 1228), so the reader's own intent to go down, while the feed is within the bottom threshold, returns following. A scroll key counts with its modifiers — Cmd+↑ and Option+↓ scroll in Chromium — and on a focused button: only Space activates a button, and Space with a modifier scrolls nothing.
- **Pressing, selection and keyboard focus hold, not pause.** While they last, the feed does not scroll on its own, and any shift of it counts as the reader's; on release an unmoved feed returns to the tail. Pressing the feed's own area is indistinguishable from pressing the scrollbar: overlay macOS scrollbars have no width. And dragging the bar gives no `pointermove`, only `pointerdown`, `scroll` and `pointerup` (same measurement), so pressing is the only sign of the reader's hand on the bar. Keyboard focus is a control reached by keyboard (`:focus-visible`), held until focus leaves the feed: riding the tail would otherwise undo the scroll that brings it into view; a control focused by a click holds nothing, or a copy button would stop the feed following.
- **A return to the tail ends a standing selection's hold.** A local submission, the jump button and opening a thread clear every hold; the selection standing at that moment holds again only once it has collapsed or left the feed. A selection inside a row still being written fires `selectionchange` with no act of the reader, and re-taking the hold then left the feed behind the answer it was asked to follow.
- **Resizes without scrolling are checked separately.** A shrink after which the new bottom matches the current position, or content fitting the screen whole, gives no `scroll`. So the surface reports every resize of the feed and its content, and a stopped feed that finds itself at the very bottom follows again.
- **A paused or held feed reads the reader's movement as the view moving over the content, not a time window.** Every correction of the feed's owner keeps the row at the top of the view at the same offset into it, so after the owner has handled a scroll event, one whose top row and offset did not move is the owner's; one that moved them is the reader's or the browser's — inertia after the finger lifted (iOS sends no touch event during momentum, and a finger catching a fling sends none either), the scrollbar, key animation, focus, find-in-page, selection autoscroll — unless a select the feed itself started is still travelling. A 250 ms window after the last input expired in the middle of iOS momentum and took the fling for the feed's own move.
