---
id: 01a15733-baa1-7d3d-bd19-4933f4f557ea
title: The right area's width is one per app and is stored with the seam sizes
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/TopBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/AreaFrame.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/RightArea.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/seams/Seams.svelte.ts
---
Width is a property of the area, not of the tab, kind, or holder: per-thread width made the area jump on every switch. It is stored where the other seam sizes live (`Seams`, key `area`), and through the `storage` event it is one for all windows. A narrow window limits only the shown width (`AreaFrame.room`), not the stored one: the area leaves `MAIN_MIN` to the main column and never shrinks below its own minimum; beyond that the main column narrows. The area always stays docked, tabs always stay in the header: the layout never changes with window width (rule [[e7449703]]).

The top row's (`TopBar`) columns align to two `AreaFrame` measurements, each written by a single owner: `stage` — the width of the window stage right of the section column (`Shell`); `docked` — the shown width of the area, the seam size held by `RightArea` while the area is shown (zero while hidden). The section column — agents or knowledge — stands outside the stage, so the place zone above it is everything left of the stage. The row paints the zone above the area only while `docked` is above zero, so a new width consumer reads these values instead of measuring the DOM itself.

The zone boundary in the row continues the seam below it rather than drawing a separate line: the section column and the area hand `AreaFrame` the `Seam` objects themselves (`show`), and the row places a second handle of the same seam above its boundary. So the header drags just like below, and the highlight is shared: hovering any handle lights up every handle of that seam. The handle above the column stands while the row paints a boundary there (the place zone is at least 240 px wide) and stays until the end of a gesture started by any handle: a handle removed mid-gesture would cancel it.
