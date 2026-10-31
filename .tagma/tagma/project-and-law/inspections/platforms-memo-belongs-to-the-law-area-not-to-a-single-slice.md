---
id: 01a132e9-2f89-7313-9b6c-b5c5e8737cb7
title: Platforms memo belongs to the law area, not to a single slice
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/walk.ts
---
Discovered starts and the already-declared-start flag depend on the law's reach: outside it a lone violation is never judged, inside it joins the shared verdict. So start, frontier, reach and the closed package contribution are split by law area; resizing or recomposing one area's slices never changes their identity. Reuse across areas lost gated crossings or carried someone else's verdict into a narrow area.
