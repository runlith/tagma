---
id: 01a185bb-ac95-7973-8556-874d3e447d8b
title: The feed stand's recorder tells the reader's movement from the feed's own by a write log, settle points and contact-target touch
ord: 86
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/stand/recorder.ts
---
The recorder wraps the scroller's `scrollTop` setter, `scrollTo` and `scrollBy` and logs every write the feed makes; an offset change alone cannot say who moved. Reader movement begins at any wheel or `keydown` on the scroller (the warmup starts it with an untrusted wheel), a trusted `touchmove`, or a rail or jump-to-latest navigation. Where the engine has `scrollend`, the first one that does not answer an own write ends it. The first `scrollend` within one frame tick of an own write is swallowed, because Chromium fires one right after the feed's instant write while a touch fling still moves, and ending there would record the rest of the fling as the feed's movement. Without an ending `scrollend` — no `onscrollend`, or a swallowed one — a settle point ends it: the next reader input, a recording's start or stop, a navigation; frames after the last offset change no own write caused are then marked still, except frames with the finger down. After a trusted `touchstart` the recorder listens on that event's target in the capture phase: a row unmounted under the finger keeps the touch's later events, the lift included, which a listener on the scroller never receives.