---
id: 01a184dc-4fbe-7b01-a2d5-4fb0ae28c378
title: record_page writes a page's session to MP4 from the engine's screencast flow
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fab5de286e3
---
**Outcome.** `record_page {page, action: start | stop, fps?}` writes what the page shows from start to stop into an MP4 file; `stop` answers the file, its duration, frame size and byte size. The agent proves a flow it fixed, and the operator watches it later without replaying anything.

**How.**
- The recorder is a viewer of the page's one screencast flow inside the engine: it declares its budget like any viewer, the flow follows the weakest budget, and frames reach it as the base64 Chrome encoded. The answer names the frame size actually recorded, which a phone viewer watching at the same time can lower. While recording, the engine holds the page's `paint`, so a hidden desktop page is still drawn.
- Frames arrive only when the page changes. The recorder places each frame by its screencast timestamp on a fixed fps grid (10 by default) and holds the last picture where no new one came — one encoded frame whose duration spans those grid slots, not repeated copies — so the clip lasts as long as the recording ran.
- Encoding and muxing reuse [[8f8c2801|timeline rendering]]: the `browser` module declares a clip-writing port (open with size and fps, write a frame, close), `page-render` fills it with its WebCodecs encoder target and its mux worker, and composition binds them. The mux learns to write a clip of unknown length without holding it in memory: with no frame count it writes moov at the end (`fastStart: false`), and the file door serves video by byte ranges so a player reads moov first. The back-pressure chain stays as [[bcb26d1b]] describes: the next frame goes to the encoder only after the previous one reached the file.
- A recording ends with its thread's run under the parent's shared rule, when the page closes, or on `stop`; every ending writes a complete file.

**Owners.** `browser` engine (`engine/screencast.ts` and a recorder beside it) and the operation; `page-render` for encoding and muxing; composition for the binding.

**Acceptance.**
- `start`, three clicks over a few seconds, `stop`: the file decodes, its duration matches the elapsed time within one frame, and its frame size is the flow's.
- A viewer watching while the page records still gets frames, and both share one `Page.startScreencast`.
- Three seconds of recording a static page yield a three-second clip.
- A recording whose starting run ended is a complete, playable file.
- A second `start` refuses `recording-running`; `stop` with nothing recording refuses `no-recording`.
- One-sample measurement, machine named: server event-loop lag and encoder memory over a one-minute recording at 10 fps.
