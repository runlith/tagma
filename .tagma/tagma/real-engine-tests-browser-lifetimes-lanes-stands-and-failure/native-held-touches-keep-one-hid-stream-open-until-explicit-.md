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
The device input scope keeps one Python SDK client alive across native actions and acquires the shared HID transport with an acknowledged empty operation before making contact. Waiting for the next contact command sends no stationary samples: queuing them during cold native startup made the first contact a long press before motion could reach it. Each contact owns a separate HID stream: normal stream EOF flushes without lifting, so a held touch keeps its companion operation open across page-side waits and sends UP before completing; the session scope owns release. Intermediate receipts confirm ordered gRPC writes, while a release receipt follows completion of its HID operation. Neither is page delivery, so callers use page input or state events for application-level facts.

A held move eases to zero speed before lifting, while an atomic swipe keeps linear motion through release. Both use the same HID stream. A page swipe starts its trajectory clock after a trusted contact confirms native startup; movement samples target that clock at no more than the digitizer cadence, with spacing treated as desired resolution. Relative native delays accumulate scheduler latency, while timing an unacknowledged contact queues the gesture before the driver is ready. The lift follows one native sample interval after the final position, without a duplicate endpoint contact. Keeping a contact still can start long-press text selection, so callers move soon after press.