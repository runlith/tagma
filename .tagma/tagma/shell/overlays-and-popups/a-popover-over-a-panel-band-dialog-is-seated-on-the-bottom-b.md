---
id: 01a0c865-c46a-72b7-bd80-58c17109ad7e
title: "A popover over a panel-band dialog is seated on the bottom bar: the half-step is sized for the overlay band and added to both"
ord: 26
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a93d-78e6-9d8d-baf01efc5a80
sources:
  - kind: symbol
    ref: packages/primitives/src/OverlayLayers.svelte.ts
    symbol: BANDS
  - kind: symbol
    ref: packages/primitives/src/OverlayLayers.svelte.ts
    symbol: HALF_STEP
  - kind: symbol
    ref: packages/primitives/src/OverlayLayers.svelte.ts
    symbol: popoverAbove
---
`popoverAbove` adds a fixed half-step of 5 to whatever depth it is handed. That figure is half of `STEP`, the overlay band's own spacing, and it is the right size there: an overlay-band ticket at 1510 gets its popover at 1515, above its own showing and below the next seat at 1520. The panel band's step is 1, and the same 5 is added.

So a popover opened from a panel-band dialog is seated five whole seats above it. From the band's floor at 75 that is 80, which is `layers.bottomBar` — the seat the panel band was cut to stay under, so that the bar dismissing a full-screen panel remains reachable above it. From any panel seat the popover clears the rest of the band as well, so it also covers any panel raised after it. The veil beneath it, at `popoverAbove - 1`, lands on 79: the band's own top seat.

Measured 2026-09-22 this is latent, not live: no production caller declares `band: 'panel'`, and the only openings that do are `OverlayLayerStack.test.ts` and `Overlay.test.ts`. The first product panel with a popover in it is where it will show, and it will show as a popover painting over the bar that closes the thing it belongs to.

The fix belongs at the producer, which is the band: a half-step is a property of the band a ticket came from, not a constant. `claim` already knows the band for every ticket it grants, so the offset can be derived from that band's own step instead of from `STEP`. Whatever shape it takes, `popoverAbove` must stop being a function of the depth alone, since the depth does not say which band issued it. Weigh against that the one thing the constant buys today — `popoverAbove` and `popoverBackdropAbove` are static and need no stack instance — and decide deliberately whether that is worth keeping.
