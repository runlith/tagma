---
id: 01a159d3-bd27-7eee-b1be-e73400202569
title: "The “…” popup stands where it opened: a pin moves the rail under it, and the next click must not hit the neighbour"
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/MorePlaces.svelte
---
A pin in "…" changes the rail under the open popup: the pinned place stands before "…", and "…" itself shifts one cell over.

Had the popup followed its trigger, it would have slid with it. The pointer would have ended over a neighbouring place's pin, and the second click would have unpinned the wrong place.

So the popup's anchor is the trigger's rectangle captured at opening. Until closed the popup stands still; the next opening stands at "…"s new position.
