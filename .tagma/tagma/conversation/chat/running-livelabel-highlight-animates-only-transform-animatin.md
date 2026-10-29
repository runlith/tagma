---
id: 01a1366b-3156-7248-ac0d-9b53be8cf02a
title: "Running LiveLabel highlight animates only transform: animating mask-position repainted the window every frame"
ord: 46
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/src/LiveLabel.svelte
---
The highlight is a copy of the text under a mask gradient. The mask sits on a "lens" three texts wide that moves right, and the text copy inside it moves left by the same amount, so the letters stand still while the mask window passes over them. Both animations are `transform`, run by the compositor without the main thread.

The previous form moved `mask-position`: style recalculation and repaint on the main thread every frame for every live label. With a dozen working threads on the page that was about 18% of the window core at rest (measured 2026-10-13, headless Chromium: 31.5% → 12.9% with only this animation off). A new animation that is not `transform`/`opacity` brings the same cost back.

There is one highlight per thread — on the run row (`LiveRunRow`); feed steps in flight do not carry it, their state is carried by the breathing tile. The period is `--beat`, the phase is shared (`inStep`), like the "working" tiles.
