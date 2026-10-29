---
id: 01a17ae1-8bc5-7327-80bd-f1fa3e873c11
title: "The seam handle highlight stands on the resized panel's border: the border on that panel's handle-facing side"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/seam/src/SeamHandle.svelte
---
At rest the handle draws no line of its own: the visible border is the panel's own `border`, and the handle lies over it with negative margins, lighting a band along its center on hover. The margins depend on the seam's `side`: at `end` the panel stands before the handle and its border is `border-r` or `border-b`; at `start` the panel follows the handle and the border is `border-l` or `border-t`. A host placing the border on the neighbour gets the highlight band a pixel and a half off the line.

One seam may have several handles — the window's top row continues the column and right-area seams with its own handle. `Seam` counts the handles under the cursor, so all its handles light together. A handle holds its own hover and carries it to a new `Seam` when the host swaps the seam under the cursor (the right area recreates it after every width save). A gesture belongs to the handle that started it: releasing another handle of the same seam does not cancel it.
