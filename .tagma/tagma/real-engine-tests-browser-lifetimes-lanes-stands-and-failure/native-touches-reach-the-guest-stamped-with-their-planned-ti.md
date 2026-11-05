---
id: 01a1846f-c12f-7bdf-9847-6ff11de4c39a
title: Native touches reach the guest stamped with their planned time, so a late host wake leaves the gesture unchanged
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/lanes/hid.ts
  - kind: file
    ref: packages/e2e/src/touch.ts
  - kind: file
    ref: packages/e2e/src/lanes/digitizer.swift
---
The guest's `SimulatorHID` builds each digitizer finger event with the timestamp its Indigo message carries, and UIKit takes touch timing and release velocity from it. idb's HID path cannot carry a planned time: its gRPC `HIDEvent` has no timestamp, and the companion stamps every message with `mach_absolute_time()` as it builds it. On the loaded CI runner host wakes ran up to 500 ms late, so every late wake became a pause in the gesture the device saw. `digitizer.swift` therefore owns touch: a helper compiled from source into the tool cache that holds a `SimDeviceLegacyHIDClient` on the lane device and sends idb's single-touch Indigo message with the time the gesture's plan gives it. A press or release is stamped when its command is handled; the samples of a move or swipe are stamped at their planned instants from the command's start. A sample whose instant has passed goes out at once with its own time and planned position, so lateness delays delivery but leaves the spacing and release velocity the guest computes unchanged. No sample is sent before its instant, so timestamps stay monotonic across commands. A tap is a press and a lift one sample interval later on the same client; idb keeps launch and quiescence. Taps left idb because its HID client is made at the first HID call, and a tap that was that call's first message reached the companion and never the page, in two runs, while later taps on the same client landed.

A command's receipt follows the simulator's acknowledgement of each of its messages, which is not page delivery: callers use page input or state events for application-level facts. Between commands a held finger stays down without stationary samples, because queuing them during cold native startup made the first contact a long press, and a contact kept still can start long-press text selection, so callers move soon after press. A held move eases to zero speed before lifting; a swipe stays linear and lifts one sample interval after its final position. A page swipe starts its plan after a trusted contact confirms native startup. The helper's stderr records each paced gesture's planned and sent milliseconds, which is the evidence of how late delivery ran.

This rests on the legacy Indigo transport that CI's Xcode negotiates. From CoreSimulator 1155.4 the guest drops Indigo input, and the DTUHID `IndigoDigitizerEvent` that replaces it carries no timestamp.
