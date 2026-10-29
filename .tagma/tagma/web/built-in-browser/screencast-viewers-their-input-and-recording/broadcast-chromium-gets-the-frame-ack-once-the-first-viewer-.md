---
id: 01a1488e-00a9-75e3-b42f-28e714f8c82a
title: "Broadcast: Chromium gets the frame ACK once the first viewer takes it, and each viewer's pace sets its RPC client's ACK"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/screencast.ts
  - kind: file
    ref: packages/cdp/src/screencast.ts
---
Every viewer holds a one-frame box — a new frame evicts the untaken one — and its feed stream takes the next frame when the socket lets the next feed part through: the feed declares a window, and the socket keeps that many unacknowledged parts in flight until the client's ACKs fall behind (the socket window is described at `socket/live.ts`). The client subscribes with `streamBufferSize: 1`, and `Live.hold` waits for the frame to decode, so the client's ACK arrives once the previous frame has decoded: slow rendering slows the feed exactly like a slow network. The engine sends `Page.screencastFrameAck` once the first viewer takes the frame. So Chromium encodes only frames someone takes: a lone slow viewer slows the stream to its own pace, a fast one leads it.

A viewer that took at least one frame but then does not take new ones for 10 seconds while they keep arriving is evicted (a page recording never is: [[5de00096]]) — leaves the budget, its feed ends at the next request, and the client subscribes anew. The term counts in time, not in the fastest viewer's frames, so that a split-second cellular dip does not throw a phone out.

A static page sends one frame when the stream starts; if no frame arrives within a second after start or restart, the engine takes a viewport screenshot. A frame reaches viewers as the base64 Chrome encoded: the kit's `castFrame` cuts `data` out by index and parses only the small remainder, so a frame of hundreds of kilobytes never passes through the server event loop's `JSON.parse`. The load measurement is in the broadcast task.
