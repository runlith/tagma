---
id: 01a165b3-4512-79cb-aed1-a652afd6a883
title: "The project crest stands on a contour parallel to the tile edge: the sign's arc around a rounded square gives uneven gaps"
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165a0-169a-73bc-bca9-0d8384487d7b
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Crest.svelte
---
In the sign, the gap between crest and dome is constant, because the dome is a circle of the same centre as the crest arc. A rounded square of the project's tile has no such circle: the sign's arc around it gave gaps from −1.6 to 2.4 px, two tiles overlapping a corner.

So the five crest tiles' centres lie on a rounded square inset 4 px from the tile edge (corner radius 6 + 4): 4 px tiles with a 6 px step keep 2 px both to the edge and between each other, the middle one stands on the corner diagonal. Coordinates in `Crest.svelte` are computed for a 32 px tile with `rounded-md` (6 px) from `Tile.svelte`: a different tile size or radius needs a recount.
