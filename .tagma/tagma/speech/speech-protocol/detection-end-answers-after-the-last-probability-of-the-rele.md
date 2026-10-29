---
id: 01a1070d-fa61-7d9b-8400-6e7671557924
title: "`Detection.end` answers after the last probability of the released audio, and then the `probabilities` stream ends: every detector track's ending stands on this"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/engine/hearing.ts
  - kind: file
    ref: packages/speech/src/engine/SpeechDetector.ts
---
The clip road and the `client` and `none` modes without word marks end a track like this: the resampler tail goes into the detector, `end`, waiting for the end of `probabilities`, the `Segmenter`'s last `flush`, then the tail commit and `finish` or the last clip. A detector that answers `end` but never ends the stream hangs the track's ending forever: `Finished` never comes, the server's listening never completes. The fake `testing` entry detector is the reference for this contract.

A `reset` on a gap can overtake probabilities already sent for the audio before it; such late windows fall below the `Segmenter`'s floor and are dropped, while speech shorter than the detector's delay right before the gap gets no clip (in `client` mode the drain commits it anyway). Both roads share one detector driver — `Hearing`.
