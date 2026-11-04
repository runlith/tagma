---
id: 01a1a80f-c36a-735b-9d92-1119ceba9a30
title: A synthetic touch fling moves a trusted finger inside the feed viewport and lets native momentum continue it
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/stand/scenarios.ts
---
The touch driver models a contact that can exist on the screen. Its path ends inside the feed's unobscured viewport; movement after release comes from the engine, so calibration measures native momentum rather than off-screen synthetic touch routing.

The finger moves through the context's touch driver (`Input.dispatchTouchEvent`, one step per frame at the declared speed, released right after the last step) rather than CDP's `Input.synthesizeScrollGesture`: on Linux Chromium that gesture delivered `touchstart` and `touchend` with no `touchmove` and never scrolled (CI run 41908384113), while the touch driver pans there. Releasing without a pause after the last move keeps the lift inside the velocity tracker's window, so the engine starts its fling.