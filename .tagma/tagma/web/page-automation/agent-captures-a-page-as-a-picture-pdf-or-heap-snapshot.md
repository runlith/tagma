---
id: 01a14c08-1c3f-7bde-a2e3-04667317c320
title: Agent captures a page as a picture, PDF or heap snapshot
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/automation.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/heap.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/read.ts
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
**Value.** The agent sees a page's rendering, saves it to PDF, and compares heap captures to find growing classes.

**How.** The `capture_page` operation: the visible part, the whole page, one element by snapshot link, PDF, or a V8 heap snapshot.

**Behaviour.**
- The file is saved on the server and named in the answer; a picture up to 5 MiB reaches the agent as an image — for a native agent and an MCP client — while a larger one stays file-only. PDF is a file for reading.
- Capture waits for a ready frame: an unshown desktop page stands in a hidden window and renders while it is captured. Picture captures request an emulation-free viewport frame before answering. On macOS, both hosts use synchronous in-process native views, so the subsequent copy fences the restored parent surface generation; it does not join descendant widgets' submissions.
- Heap capture writes a local `.heapsnapshot` that Chrome DevTools opens, with totals, detached native-node count, bounded largest-class rows and positive growth against the previous capture. Each displayed class carries its count and self-size change. The pause hold prevents the snapshot's stopped renderer from being diagnosed as hung; its duration is an upper bound on the renderer pause. Heavy reading and comparison run off the server loop, serialized with trace analysis.
- A page keeps its last 20 picture/PDF captures and four heap captures, with pruned heap paths named in the answer; closing the page deletes them.

**Limits.** Heap capture covers the main frame's V8 isolate, not other-process frames; same-isolate pages can appear. Desktop watchdog pause follows the captured renderer process. Managed watchdogs and unknown-identity engine frame probes conservatively pause for the profile, delaying detection of a genuinely hung other page or frame until capture ends. An admitted capture keeps its producer's hold through caller interruption or chunk-write failure. Files contain heap strings including credentials and stay local; only class names enter the answer. Desktop's native file route is established from Electron 44.8 source, but remains unproved by a desktop run. Access matches [[4096201b|agent-driven pages]].
