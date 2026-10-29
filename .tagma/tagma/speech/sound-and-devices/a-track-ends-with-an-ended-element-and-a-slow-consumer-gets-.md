---
id: 01a105cc-b80f-7786-9a9e-f0d0101c04ce
title: A track ends with an `Ended` element, and a slow consumer gets an `overflow` gap instead of a growing buffer
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/audio/src/helper/capture.ts
  - kind: file
    ref: packages/audio/src/sound/track.ts
---
A track ends because of data, not failure. So it goes last as `Ended{reason}` in `chunks`, after which the stream completes. Effect `Stream` carries no completion value, and an error channel would force every consumer to catch an ordinary `drained`.

One loop reads the socket for all resources, and stopping it for one slow consumer is not an option: the other tracks and players would stall. So the client keeps a per-track buffer bounded by audio duration. Audio beyond the buffer never piles up: it becomes an `overflow` gap with an exact range, delivered ahead of the next accepted chunk. Closing a track's scope drops the buffered audio: interruption leaves no tail.
