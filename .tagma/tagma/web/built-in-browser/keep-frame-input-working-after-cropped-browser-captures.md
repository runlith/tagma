---
id: 01a185b3-9d76-7098-a622-f922d0b17e2d
title: Keep frame input working after cropped browser captures
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a185b3-59de-7e49-bd75-8748d3a2deae",
    "status": "done"
  }
---
Repair the managed Chromium cross-site picking hang without retries, sleeps or raised timeouts. Ref clicks and hovers must use their known frame session before its first compositor frame is routable; coordinate input keeps the painted-root path. Picture capture must restore the rendered viewport before answering, including clips, classic scrollbars and device emulation.

The original scenario hung for 180 seconds on seed 2: /tmp/runlith-test/reports/run.99363.1793244515758.jsonl. A root-route counterfactual split one press between the parent (mousedown) and late child (mouseup): run.96356.1793251455812.jsonl. Its native event-count probe was temporary and is not retained. The new crop's classic-scrollbar counterexample returned 162×61 instead of 160×60 (run.18307.1793252337438.jsonl); effective device/visual scale now preserves 160×60 and DPR3 480×180. Captures retain the primary image, then an emulation-free secondary session requests a surface frame. That transaction survives interruption; its ordering after ack-throttled browser-side resize acknowledgements remains unproved.

Final whole engine+screencast runs passed 40/40 on seeds 1, 2 and 3: /tmp/runlith-test/reports/run.42551.1793253561512.jsonl, run.43926.1793253618110.jsonl and run.45213.1793253672747.jsonl. The retained cross-site case also checks actual operator-coordinate click state after visible, oversized and full captures, with classic scrollbars and DPR3; one sample took 854/962/884 ms on Apple M2 Max, 32 GiB, macOS 26.0.1, Chrome for Testing 151.0.7922.71. Automation's 8 tests and server/CDP typechecks passed. Independent review found the scrollbar-scale and emulated-barrier gaps; both were corrected without a second review. Desktop uses the same flattened secondary-session path, supported by Electron 44.8/Chromium 152 source only; no Electron or installed-Chrome run was made. Capture followed by scrolling back to a frame is a separate discovered-from follow-up, not claimed fixed here.
