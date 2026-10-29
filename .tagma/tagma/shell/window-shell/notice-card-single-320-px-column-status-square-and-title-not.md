---
id: 01a16b9e-89b8-70ba-8438-34fca7f74bfb
title: "Notice card — single 320 px column: status square and title, note below, buttons at the bottom"
ord: 17
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16896-f474-7dbd-a7e8-99a7a6452b90
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NoticeCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/wire/told.ts
---
The card is drawn by the chat kit's shared `Callout`, the same one behind the refusal above the input field and the "could not read" card; the notice only sets its popover surface and width. The card is a single 320 px column. Status square and title on top, close cross absolutely positioned in the corner. The note follows below on the same left edge, buttons left-aligned further below. The old "icon | text | actions" grid squeezed text into a narrow middle column and left an empty column under the icon. And `w-max` gave each card its own width, so left edges danced across the stack.

The square sits inside the title line, so wrapped text flows under it. Red means refusal or failure, grey means an offer (`Offer`). Undo has no square. No left stripe or lucide icons: in the app the square draws state, and the lock on the offer read as "forbidden".

The note is a separate message field (`Told.note`), not a continuation of the title. The producer puts the consequence there ("What was heard stays; nothing was sent.") instead of appending it to the refusal words: concatenation without a period produced "Dictation needs the app What was heard…". Single-line spots like the dictation pill join both parts through `toldLine`.

Undo is one line: "text, Undo, ×". The bar at the bottom drains over `lifeMs`, set by `Notices.undoable` (that's `UNDO_LIFETIME_MS`). The bar shows the same lifetime after which the card disappears, so the duration comes from the notice rather than being set in the card a second time.
