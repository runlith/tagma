---
id: 01a1488e-00b0-7c56-9342-85df17a2e154
title: The broadcast viewer's layout is the layer under agent emulation
ord: 3
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/browser/engine/emulate.ts
    symbol: effectiveOf
---
`Paged.layout` is the viewport of the first viewer that asked for a layout, on the host page with `native: false`. `effectiveOf` applies it only while agent emulation sets neither viewport nor device — when a session connects and on every agent emulation. So removing the agent emulation returns the page to the viewer's size, not to the build window, and an agent checking its dev server on a device does not yield to the viewer. Layout switches go through the page queue to avoid interleaving with agent emulation. The layout pixel density is 1: with no window, the broadcast frame arrives in CSS pixels, so density 2 only quadruples the page raster and the agent snapshots for nothing (one sample: Chrome for Testing 151, a 1052×652 layout with `deviceScaleFactor` 2 produced a 1052×652 frame).
