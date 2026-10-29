---
id: 01a17b76-c22c-7dce-89a0-3ab20410fa0c
title: The ScreenSettled subscription reports that the screen stood still for quietMs after movement, copying and encoding no frame
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/Presentation.ts
  - kind: file
    ref: packages/execution-host/src/subscriptions.ts
---
The `Screen` subscription produces a frame per screen move, paid by both the host (mirror copy, patch encoding) and the reader (decoding). An observer needing a settled screen, not every redraw, needs none of that. A CLI question, for instance, stands on screen while the CLI awaits input. While the CLI animates a spinner, such an observer on the `Screen` subscription would pay per frame, and with screen reading per change twice as much.

`ScreenSettled` (capability `screen-settled`) holds the viewer only as a "screen moved" mark. Every move records its moment, and the subscription sleeps until the last move's moment plus `quietMs` and checks again. A frameless event leaves when the window expires with no new move. So the subscription wakes at most once per window, however many moves. The first event reports the screen as it stood at subscription. While the screen changes more often than the window, the host sends nothing. Such a viewer copies nothing, so it takes no execution-reader place: those places are held by windows and byte reads. What is on screen the reader learns by ordinary `Screen` reading after the event. The subscriber sets the window: it is their definition of a settled screen, the host never invents it.
