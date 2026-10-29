---
id: 01a18645-f2a5-71ef-bdaf-200943bf3667
title: Establish frame input readiness after capture and scrolling back
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a185b3-59de-7e49-bd75-8748d3a2deae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a185b3-9d76-7098-a622-f922d0b17e2d
---
Repair the root-coordinate frame click lost after capturing an oversized document element at y=1000 and scrolling back through a ref click. Native reveal answers before the new root surface must be routable. Measure the target's local center and each enclosing widget origin before/after reveal, reusing frame-owner identities; request the emulation-free surface barrier only when placement changes. Zero-delta ref scroll shares this producer. Unchanged placement adds one geometry request per widget session and forces no frame.

Red /tmp/runlith-test/reports/run.61616.1793254638726.jsonl reached Clicked9 rather than10 after the captured leg, while DOM scrollY=0 and the iframe was back at (80,260); its parent received the press/up. The retained public-operation test compares identical scroll/ref-click/root-click legs without/with capture and asserts Clicked8/10. A nested root+700/inner−700 case preserves the same target rectangle and asserts its real click, distinguishing placement change from every possible offset change.

One main-frame sample per arm on Apple M2 Max, 32 GiB, macOS 26.0.1, Chrome for Testing 151.0.7922.71, one testbed worker: previous scrolled/visible clicks 13.57/1.77 ms, fixed 34.79/3.12 ms (+21.22/+1.36 ms in those samples). Reports run.96586.1793255773833.jsonl and run.98339.1793255845155.jsonl; timing probes were temporary and removed. Whole engine+screencast passed 40/40 on seeds 1/2/3: /tmp/runlith-test/reports/run.84925.1793257225603.jsonl, run.86926.1793257281450.jsonl, run.92944.1793257338650.jsonl. After review, retained A→OOP B→OOP C coverage passed the focused case on all three seeds (run.35177.1793258965317.jsonl, run.39757.1793259124628.jsonl, run.40086.1793259131371.jsonl), but root redraw does not prove B's compositor submission; that source-level limitation is qualified in [[0a53c2ac]]. Automation 8/8 and final server typecheck passed. Desktop is source-only. No natural-paint wait, retry, sleep or new timeout is added. Native renderer-layout synchronisation is under [[f99cd9bd]]; capture restore's browser hit-test-surface ordering remains qualified in [[d0baf766]], separate from the reported root-scroll case.
