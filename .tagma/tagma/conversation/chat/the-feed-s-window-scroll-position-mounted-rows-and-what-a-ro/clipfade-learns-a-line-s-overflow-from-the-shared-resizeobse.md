---
id: 01a1846a-6e5a-71e3-bff2-38e6767051b1
title: "`clipFade` learns a line's overflow from the shared ResizeObserver's first report, not when it attaches"
ord: 5
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18404-f6df-7814-bb9e-c815d7dbe006
sources:
  - kind: symbol
    ref: packages/chat-ui/src/clipFade.ts
    symbol: clipFade
---
A ResizeObserver reports every newly observed element with a size before the frame is painted, so the first painted frame already carries `data-clipped`. Reading `scrollWidth` at attach forced a layout per faded line while a feed mount was still inserting rows — a jump mounting a window of steps paid one layout per line. An element with no size is never reported and shows nothing to fade; it is measured when it gets one. A change to the line's text observes it again instead of reading it: a newly observed element is reported in the observer's next pass, after layout, where a read in the mutation callback forced a layout while a mount was still writing text into its rows. Without a ResizeObserver (tests in jsdom) the line is measured at attach.