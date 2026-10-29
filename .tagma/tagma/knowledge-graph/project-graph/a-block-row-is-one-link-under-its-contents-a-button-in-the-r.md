---
id: 01a175bc-4df0-7e89-88ed-89730da203e8
title: A block row is one link under its contents; a button in the row raises itself above it
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/BlockRow.svelte
---
`BlockRow` lays one `a[data-block]` as the row's first element across its whole area, and a click anywhere in the row lands in that link. It is caught by `linkWithin` in the block tab and the page navigation in Knowledge. The row has no click handler of its own, so it opens like any block anchor in the same place.

A control above the link must be positioned (`relative` or `absolute`) and receive the pointer. Otherwise the link lies above it, and the click silently opens the block. The facts column on the right (`pointer-events-none`) lets the pointer through to the link. Reason: on hover the `fade-under` mask makes the column a separate layer above the link, and without this the time and chips would steal the click only on hover. Every column control, whether status, holder or a mark with a tooltip, enables the pointer itself (`pointer-events-auto relative`). The title in edit becomes `relative` and rises above the link. Outside edit it sits under it, so the mouse does not select it.
