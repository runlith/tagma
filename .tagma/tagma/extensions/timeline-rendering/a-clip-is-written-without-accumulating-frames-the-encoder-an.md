---
id: 01a17037-bd34-74d2-8db3-89e9bcb26d1b
title: "A clip is written without accumulating frames: the encoder answers when the queue is at most 2, the multiplexer on every batch, `Render` pulls the next frame after writing the previous one"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/artifacts/videos.ts
  - kind: file
    ref: apps/tagma/server/src/page-render/clips.ts
  - kind: file
    ref: apps/tagma/server/src/page-render/encoder.ts
  - kind: file
    ref: apps/tagma/server/src/page-render/film.ts
  - kind: file
    ref: apps/tagma/server/src/page-render/mux.worker.ts
---
Frames pile up neither on the server nor in the browser, because all three steps hold each other. Encoding a frame in the target encoder returns only once the `VideoEncoder` queue has drained to 2. The multiplexer answers every packet batch with one. The `Render` stream, with parallelism across the target count, pulls the next frame only after the previous one reached the file. Loosen any link — say, send packets to the worker without an answer, or hand a frame to the encoder without awaiting the queue — and the queue grows with the clip's length, and a 300-second 4K clip eats the machine's memory.

The encoder stands in a separate target, not the shooting target: the user's page runs its own code and can break or occupy globals, while shooting targets queue into `Render` several at a time. So every frame travels to the server as a snapshot and back into the encoder — the price of having an encoder in every install without ffmpeg, and snapshots cost JPEG q95, not PNG.

`mediabunny` writes the file with `fastStart: 'reserve'` for the frame count known in advance. Without it `moov` would land at the end (such a file on a phone only starts playing after it downloads fully), or the multiplexer would hold the whole clip in memory until the end. A page recording (`Clips`) has no frame count in advance, so its file is written with `moov` at the end; it reaches players through the file door's byte ranges, which let them read `moov` first. The track `frameRate` pins timestamps to the fps grid: the encoder's microsecond marks (33,333 µs at 30 fps) would otherwise give a duration not a multiple of a frame.

The file is written as `.part` and renamed only after `moov` is written: the version's `video-<fps>-<scale>x.mp4` name is itself the sign of a finished clip for the shelf, the route and re-export.
