---
id: 01a14113-6b8c-74b5-b733-9115a1d9d17c
title: Capture writes to the socket on its own thread through a 10 s audio queue, so a stalled server loop never cuts sound
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/CaptureSink.swift
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Session.swift
---
The server reads the helper's socket on its own event loop, and under load the loop stalls for hundreds of milliseconds, longer on a weak machine. When the capture consumer thread wrote to the socket itself, it stalled with it, sound accumulated in the realtime ring (a quarter second) and the socket buffer, and a read stall longer than about half a second cut the dictation with an `overflow` break.

So each capture has its own queue and writer thread (`CaptureSink`): the ring consumer only enqueues and never waits on the socket, leaving the ring to cover only consumer scheduling. The queue holds 10 s of audio — as much as the server-side helper client holds for a slow consumer ([[101c04ce]]); audio past the window never accumulates but becomes a single `overflow` break with an exact range before the next accepted event. Ring overflows merge into the same range, else a long stall would grow the queue with breaks though the audio in it is bounded. The window counts after conversion (16 kHz mono int16), so memory does not depend on device rate or channel count.

A capture's `end` stands last in the same queue: it never overtakes its resource's audio and breaks, while the session thread does not wait for the writer to flush the backlog and holds up no other resources. A channel write failure marks the capture failed and clears the queue. Session completion abandons the queue without waiting for the writer: its socket wait would interrupt channel close.
