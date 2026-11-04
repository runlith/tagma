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

A held move eases to zero speed before lifting, while an atomic swipe keeps linear motion through release. Both use the same HID stream. Swipe subdivision is capped by the digitizer cadence, with spacing treated as desired resolution: a fixed fine spacing can request hundreds of samples per second, turning a short fling into a slow drag. Delays travel with the native samples, so driver startup cannot queue the entire timed trajectory before the contact starts; the lift follows one sample interval after the final position, without a duplicate endpoint contact. Resting samples do not prevent long-press text selection, so callers move soon after press.