---
id: 01a159d3-bd8a-70c0-9aaf-8f7359e37aa5
title: Reordering with one gesture accepts an element from another container and gives its own to the sink
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/Reorder.svelte.ts
---
`Reorder` is one drag gesture for every list in the app: the projects dock, tabs, settings lists, the model catalog, the rail. Moving between containers is part of the same gesture, not a second mechanism.

**Entry (`inlet`).** An element of a source container can be carried into the list.
- The source declares which ids it carries and what to do when an element is dropped into the list.
- An element enters the list while the pointer is in the list's band across the axis (for a vertical list — across the width), at any height. So a place dropped below the rail's lowest icon lands at the end.
- While the element is in the band, `incoming` names its id, if the list does not have it. The consumer draws the element in the list, and it follows the pointer as its own.
- Dropping outside the band cancels.
- The source does not reorder: its rows only dim while the element is carried away.

**Sink (`outlet`).** This is an element that the list's own elements are dropped onto.
- While the pointer is over the sink, `data-reorder-over` stands on it, and `leaving` tells the consumer the element is leaving.
- Releasing hands the id to the sink instead of reordering.

**Carry-out (`beyond`).** A list given `Beyond` releases its own element past its bounds. For example, a project from the bar or from tabs is carried into the composer.
- The start threshold of such a list counts in every direction, not only along the axis. Otherwise a tile dragged strictly across could never be lifted.
- While the pointer is outside the band and not over a sink, the element stands at its source spot in source order. The pointer gets `beyond.follow`, and release gets `beyond.drop`.
- A returned element reorders again. Releasing outside the band, which `drop` did not accept, changes nothing.

Threshold, selection clearing, `Escape`, `blur`, `pointercancel` and swallowing the click after the drop are the shared `lift` primitive (`shared/lift.ts`). The thread-column drag and lifting a project from the menu stand on it too.

**Limits.** Positions count from `offsetTop`/`offsetLeft`: they do not see the `glide` animation transform, and the index does not shake while neighbours ride. For entry the pointer is translated into the same coordinate system via the list elements' `offsetParent`. That parent must be shared by all elements of the list.

Native dragging on handles is banned. Otherwise a link-handle would start the browser's drag, and it breaks the gesture with `pointercancel`.
