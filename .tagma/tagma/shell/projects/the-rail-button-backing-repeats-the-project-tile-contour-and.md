---
id: 01a165f0-b92e-7022-bbac-5ddefb22bd2d
title: The rail button backing repeats the project tile contour, and the dot and counter on it are square
ord: 5
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165d5-d5a5-785f-bfe2-a3acf0e82349
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Tile.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/rail.ts
---
The place buttons (`rail.ts`) and project tiles (`Tile`) stand in one rail column, both 32 px. With 10 px rounding against the tile's 6 px, the column read as two different squares, so the button backing takes the same `rounded-md`. Whoever changes one's rounding changes the other's. The dot and counter on the button are square, because the app draws state as a square.
