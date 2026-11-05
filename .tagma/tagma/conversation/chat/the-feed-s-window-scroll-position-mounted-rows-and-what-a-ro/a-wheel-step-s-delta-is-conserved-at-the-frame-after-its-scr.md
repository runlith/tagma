---
id: 01a1a904-4572-76d1-bfa5-7f13b1b0a33c
title: A wheel step's delta is conserved at the frame after its scroll settles, and never exceeded before it
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/stand/wheel.ts
  - kind: file
    ref: packages/chat-ui/stand/recorder.ts
---
An engine may animate a wheel scroll over later frames: Linux WebKit spreads one delivered delta across several frames (CI 41913034331), so a per-frame equality judges the embedder's interpolation, not the feed. The settle point is the page's own fact — the first trusted `scrollend` after the step that does not answer an own write, recorded as `Recording.scrollEnds` — never a frame count or a time. A `scrollend` answers an own write when a write that moved the scroller came after the previous `scrollend`: the feed's write just before a wheel ends its own scroll sequence while the wheel's animation still runs (Linux WebKit, CI 41950402402), and settling the wheel there judged the rest of its animation as excess.

Until that frame the content may lag the delivered delta but must not exceed it or move against it; at that frame it must equal it within one device pixel, so lost or added scroll and anchoring jumps stay caught on every engine. A recording without a following `scrollend` keeps the per-frame judgement. Scenario code that needs a wheel's end waits on `wheelSettled()`, which answers from the same event; a wheel that never scrolls never settles, so a caller must only wheel where the scroller can move.