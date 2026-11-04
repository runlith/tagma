---
id: 01a159d3-bcce-703b-a1b2-afa3bf1cea35
title: "The rail set keeps two lists: pinned in order and removed daily ones, so a new daily place arrives on its own"
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/RailPins.svelte.ts
---
One pinned list is not enough. Had only it been stored, a place the next version makes daily (`pinned` in the section declaration) would not have appeared for anyone who ever changed the rail. Had the difference from the default been stored, no order could be kept.

So two lists are stored: pinned places in order, and daily places the operator removed. The rail is the pinned ones, then daily ones in neither list. The first reorder, pin or unpin writes the default explicitly into the pinned list.

The list also keeps places missing from the current project (a disabled app's section). A move inserts the place before the visible neighbour, so such places keep position and stand on it when the app returns to the set.

Every record first re-reads the window's copy of the app document, which the server's feed keeps current with what other windows wrote. So two windows do not overwrite each other's set.
