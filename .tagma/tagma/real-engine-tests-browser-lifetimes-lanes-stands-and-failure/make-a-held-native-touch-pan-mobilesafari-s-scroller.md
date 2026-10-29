---
id: 01a18559-7795-7e6b-8267-641af261fa90
title: Make a held native touch pan MobileSafari's scroller
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18358-6882-7146-96af-279f8f0fbb3e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18456-7235-7c5f-b458-64abcdc59b7d
sources:
  - kind: file
    ref: packages/e2e/src/lanes/hid.py
  - kind: file
    ref: packages/e2e/src/lanes/hid.ts
---
On iOS 26 the held native Touch (one HID stream, DOWN at successive points, explicit UP) delivers trusted touchstart and touchmove to WebKit, but MobileSafari's scroller never pans. held-driver measured that scrollTop stayed fixed under three move shapes in packages/chat-ui/stand/native.e2e.ts, while idb `ui swipe` pans the same page. The shared conformance proveTouch asserted only touch events, so the delivered held-touch unit never proved scrolling. Add "a held drag moves the scroller while the finger is down" to the shared conformance, red on iOS first, and fix the native producer, never the stand driver.

Measured on iOS 26, packages/e2e/src/lanes/ios.e2e.ts through proveTouch with only passive listeners. Press, then two 80 pt held moves, leaves #list.scrollTop at 1000 while `active` is 1 and trusted touch events arrive. Chromium pans under the same conformance. Interpolating each move into 5 pt samples every 8 ms, like `ui swipe`'s sampling, did not change it (run.10615.1793239620882.jsonl). In pinned idb 1.7.7 both paths reach the guest as dtuhid digitizer start/position/end, so the difference from `ui swipe` is not the event types. The difference is that the samples go through a long-lived gRPC HID stream rather than one composite operation. Both experiments were reverted, and no change landed.