---
id: 01a14a77-03be-73fe-bc58-71abf126d14a
title: A hung renderer of another-process iframe is invisible to the "unresponsive" probe, and attaching such a frame can wait without a deadline
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18444-f9dd-7094-9360-03bfeb88fb40",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1484a-2e3b-77ca-b058-0914c4428b2f
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/target.ts
  - kind: file
    ref: packages/cdp/src/probe.ts
---
The "unresponsive" probe (`watchResponsive`, host) asks only the main-frame renderer. When an OOPIF renderer hangs, the page stays `responsive`. The following then hang with no verdict:
- its attachment in the engine: `adoptChild` in `browser/engine/drive.ts` sends `*.enable` into the frame session and waits without a deadline;
- waits for that attachment: `joined` in `browser/engine/target.ts`, holding the snapshot and point actions;
- commands in its session.

The work holds the page queue, and the guard interrupts it only on `closed`, `crashed`, and `unresponsive` of the main state.

What to decide: how the engine learns that a frame renderer hung. Options:
- a per-attached-frame session probe — on the host or in the engine;
- a driven-work verdict by the probe of the frame it addresses.

The refusal names the frame. In-place reload refuses when a fresh renderer cannot be guaranteed without affecting other pages. The unblock offers another profile or waiting for the profile browser to end after its pages close; it names live same-profile pages with their opening thread or non-thread origin, and permits an agent to close only its own pages without asking the operator. Proof is an OOPIF with `for(;;){}` discovered by a first-call reload during attachment yielding a typed refusal, later snapshots and point actions refusing as well, aggregated page responsiveness surviving a healthy main-frame signal, and safe close without holding the queue.
