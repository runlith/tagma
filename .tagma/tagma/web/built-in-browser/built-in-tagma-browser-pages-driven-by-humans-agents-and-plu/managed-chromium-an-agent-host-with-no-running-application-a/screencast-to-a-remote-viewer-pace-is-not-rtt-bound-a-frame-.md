---
id: 01a148b4-4556-7745-997a-48dbe5d27a9b
title: "Screencast to a remote viewer: pace is not RTT-bound, a frame is not serialized per viewer, frames do not pile in the drive subscription"
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a147d6-7ef4-7c9c-9e39-feae8df087e4
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a10eb1e2301
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/screencast.ts
---
Delivery 8df087e4 review (code reading, not a measurement):
- The Effect RPC server waits for the client's ACK on every frame, so a lone network viewer gets at most one frame per RTT plus the frame transfer: at 100–300 ms RTT that is single-digit fps. The delivery measured only over loopback.
- RPC serializes the same base64 frame separately for every viewer of the page.
- The drive subscription to session events is an unbounded `PubSub` queue; while drive awaits a CDP or Store answer, hundred-kilobyte frames pile in it.
- A viewer-area change restarts the flow and the layout on every animation frame while the human drags the seam.

Done when a measurement with artificial RTT (say 150 ms) shows a pace not bound by RTT, and a two-viewer measurement on one page shows per-frame event-loop cost that does not grow with viewer count.

**Result.** A feed window in the socket (`e9d905d8b4`), separate filtered CDP-session subscriber queues, and merged viewer-area changes (`287ed8a865`). The `scripts/bench-screencast.ts` measurement — one sample: M2 Max, macOS 26.0.1, Bun 1.4.3, Chrome 155, a machine loaded by other agents, 10 s phases, RTT through the script proxy. A light page, one viewer, 150 ms RTT: 6.6 frames/s windowless → 38 frames/s with a window (49 over loopback). Two viewers of one page at 150 ms RTT: 38 frames/s each, server CPU 3.8% vs 3.6% for one viewer. A heavy page (frame ~630 KB) at 150 ms RTT: 6.1 → 13–17.6 frames/s; past that the proxy bandwidth binds.

A frame is still serialized per viewer: an in-process profile showed per viewer and 630 KB frame about 0.12 ms in `JSON.stringify` and 0.13 ms in socket `sendText`. Those are two memory-speed copies, not parsing. Per-viewer socket sends cannot go away, and splicing pre-encoded JSON would replace `stringify` with the same copy while requiring a bypass of the Effect RPC serializer for one feed. So it was not done.
