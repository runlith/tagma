---
id: 01a10701-1112-7f2f-8581-26873b3573d1
title: A started socket frame is kept whole; clear confirms the render thread
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Player.swift
  - kind: file
    ref: packages/audio-darwin/native/Sources/AudioCore/Socket.swift
  - kind: file
    ref: packages/audio-darwin/native/Sources/Realtime/output.c
---
A Unix stream cannot cancel an already-sent length prefix: a partially handed frame is finished under one serialization, else the next control would turn into the previous frame's PCM. A capture audio frame is never dropped for a busy socket: the capture writer waits for room while audio accumulates in its queue ([[a1d9d17c]]), whose overflow yields one `overflow` break for the whole lost range. Dropping on `EAGAIN` cut audio on any server read pause longer than the socket buffer (hundreds of ms) and split the loss into one-chunk breaks. Channel close interrupts the socket wait. A clear's mark outcome comes from the render thread's confirmation with the actual skipped range; the next clear does not replace that confirmation until the player owner has read it.
