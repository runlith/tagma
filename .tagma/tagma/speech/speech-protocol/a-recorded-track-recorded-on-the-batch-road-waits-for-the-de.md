---
id: 01a13818-1458-74fc-93b7-0958b03fcb80
title: A recorded track (`recorded`) on the batch road waits for the detector and the clip queue instead of losing clips to `budget` gaps or dropping the detector
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/engine/clips.ts
---
The batch road is built for live audio: the clipper drops a clip with a `budget` gap when queued audio would exceed `clipQueueMs`, and the Whisper detector refuses (`DetectorBehind`) when it waits unanswered for more than 10 s of audio. A decoded recording outruns both by orders of magnitude and would lose most of the recording or crash.

With `recorded: true`, reading the next chunk waits until the detector lags by no more than 2 s of audio and the queue holds no more than `clipQueueMs` minus the longest clip minus those 2 s: not-yet-heard audio adds at most one clip up to the limit long plus the clips inside those 2 s, so the queue never crosses the limit, and memory is bounded by it. Heard probabilities, a processed clip and the road's end wake the wait. The 2 s threshold must stay below every detector's tolerance; live audio cannot wait, so without the flag behaviour is unchanged.
