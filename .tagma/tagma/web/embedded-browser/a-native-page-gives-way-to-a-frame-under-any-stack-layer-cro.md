---
id: 01a18450-436b-7e8b-9e5a-246e83d2237d
title: A native page gives way to a frame under any stack layer crossing its panel and during any window drag
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a147b0-e165-75df-b2b0-9a0e255c4582
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/view/drags.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/view/NativeView.svelte
---
The native view lies above all window HTML, so the panel itself decides when the page must give way: while any rectangle of the kit layer stack (`overlayLayers.rects` — open layers and shown notices) crosses the panel's box, or while a drag holds the pointer anywhere in the window. It then paints a frame main captured, and only once that frame has decoded and two frames have passed does it freeze the view (`freeze`), which main parks; when both conditions end it unfreezes and the view returns. Painting before parking keeps the page from blinking to an empty panel, and the frame stays under the returned view for the same reason: the panel learns nothing of when main has put it back. A failed capture still parks the view, because a layer the reader cannot see is worse than a blank page.

Freezing is not hiding: a frozen view keeps the panel's claim on the page in main (`Placement.freeze`), so another panel showing the page meanwhile tells the frozen one it is shown elsewhere, and thawing never pulls the page back from it.

The frame is taken on the stack's intent to open (`overlayLayers.onIntent`: a trigger press, an opening key, `Overlay.open`), so it is usually ready when the layer lands. An intent may open nothing, or a layer far from the page, so a primed frame serves only an overlap that starts within a second; later, and for a notice that arrives with no intent, the panel captures when the overlap starts and the layer stays hidden under the page until that frame arrives.

Drags are observed at the window, not published by each drag mechanism: seams, `lift` reorders, terminal pane moves, text selection, sliders and native drag-and-drop all lose the pointer to the view the same way, and a drag mechanism added later is covered without knowing the browser exists. A press alone takes no frame — that capture would be paid on main's event loop by every click in the window; the freeze starts once the pressed pointer moves a few pixels, and each drag costs one capture.

Main encodes the frame as JPEG rather than PNG: the frame stands in only while a layer or a drag lasts, and the encode runs on main's event loop, which also drives window input.
