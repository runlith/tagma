---
id: 01a1855e-c5d0-70fd-b3de-ac235de00096
title: A recording is a never-evicted screencast viewer that places each frame by Chromium's timestamp and holds it until the next
ord: 4
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fb0ae28c378
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/recording.ts
  - kind: symbol
    ref: apps/tagma/server/src/browser/engine/screencast.ts
    symbol: makeScreencast
---
The recorder joins the page's one screencast flow as a viewer, so recording costs no second `Page.startScreencast` and other viewers keep their frames. Two things set it apart from a person's viewer. It is never evicted: encoding a frame can take longer than a viewer may stall, and an evicted recorder would end the clip. It also takes no chooser notices. Like any viewer it holds a one-frame box. Frames arriving while it encodes replace the boxed one, and each frame is placed by Chromium's own frame timestamp, not by when it was taken. So a slow encoder makes the clip choppier but never shorter or longer.

A picture holds until the next one arrives: it is encoded once, with a duration spanning the grid slots it covers. A still page costs one encoded frame, not `fps` frames a second. Only when the next picture arrives (or the recording ends) is the span known, so the last picture is always one frame behind the stream. The end of a recording is the moment `stop` was asked, the run ended, the page closed or the engine session it started on ended, not the moment the encoder finished. Ending with the session matters because the screencast reattaches to a restored page: a recorder that outlived its session would keep running while the page's live state, reset by the drop, no longer shows it. Ending is in-band: the recorder still takes a frame already delivered to its box, and drops frames shown after the end, so a change the page showed just before `stop` is in the clip. An ended recording — its file or its failure — is kept per page until a `stop` from the thread that started it collects it, or a new recording starts on the page; another caller's `stop`, such as the operator's from the panel, is answered and leaves it kept. So the clip reaches its starter's thread however the recording ended. A page close and a lost session both read as `session-ended`: closing a page ends its engine session before the page-state owner publishes the close, so the two cannot be told apart without a race.

The clip opens on the first frame, at that picture's size. An H.264 stream keeps one coded size, so a later frame of another size is fitted into it: a viewer joining with a smaller budget, or a resized window. `start` answers only after that first frame is open in the encoder, so a missing capture browser or codec refuses `start` instead of surfacing at `stop`.

The file is written as `.part` and renamed once complete; the name is what makes a recording finished. A server shutdown mid-recording leaves the `.part`, and the next prune of that page's directory removes it.
