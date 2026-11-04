---
id: 01a1a80f-c36a-735b-9d92-1119ceba9a30
title: A synthetic fling keeps the contact inside the feed viewport and lets native momentum continue it
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/stand/scenarios.ts
---
The touch driver models a contact that can exist on the screen. Its path ends inside the feed's unobscured viewport; movement after release comes from the engine, so calibration measures native momentum rather than off-screen synthetic touch routing.