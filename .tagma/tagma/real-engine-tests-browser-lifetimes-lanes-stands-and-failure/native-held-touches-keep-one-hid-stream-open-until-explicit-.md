---
id: 01a1846f-c12f-7bdf-9847-6ff11de4c39a
title: Native held touches keep one HID stream open until explicit release
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/lanes/hid.py
  - kind: file
    ref: packages/e2e/src/lanes/hid.ts
  - kind: file
    ref: packages/e2e/src/touch.ts
---
Normal HID stream EOF flushes without lifting a native contact. A held touch therefore keeps one companion operation open across page-side waits and sends UP before completing; the session scope owns release. Intermediate receipts confirm the Python client's ordered gRPC write, so callers use page input or state events for application-level facts.

The client samples a move at 120 Hz along a smootherstep ease that reaches zero speed at its end, and repeats the resting position between commands as a resting digitizer does. The ease is what keeps a lift from flinging: repeated identical positions do not count as movement, so rest samples alone leave a lift flinging; so a held drag pans, rests and lifts without momentum, and a fling is idb's atomic swipe. Rest samples do not prevent long-press text selection either: a finger held still after press past the long-press window selects text, so callers move soon after press.