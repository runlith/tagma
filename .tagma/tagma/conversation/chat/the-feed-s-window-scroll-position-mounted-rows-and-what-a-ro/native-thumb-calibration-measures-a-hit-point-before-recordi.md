---
id: 01a1a815-afe9-7afc-85e0-be904f677f81
title: Native thumb calibration measures a hit point before recording its drag
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/stand/thumb.ts
---
Native scrollbar themes can reserve arrow-button space and enforce a minimum thumb size that the DOM does not expose. Native page-step direction narrows the hit point before the control starts, so calibration records thumb motion rather than a track click. The control continues the successful press, keeping localization and dragging one native interaction. A sample after a pointer step first waits for the native scroll to leave the previous sample's top: two still frames alone can be read before Chromium applies the step, and those stale samples bias the fitted scale enough to fail a long drag chain.