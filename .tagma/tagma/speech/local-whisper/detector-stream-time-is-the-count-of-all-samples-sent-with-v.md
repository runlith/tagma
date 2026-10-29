---
id: 01a106dc-8883-7870-8b26-5c8a6ea44cb1
title: Detector stream time is the count of all samples sent with `vad.open`; `vad.reset` drops the incomplete window, `vad.end` counts it up
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech-whisper/native/src/detector.cpp
---
`at` in `vad.probs` is the index of the window's first sample among all samples sent into the stream, and reset does not zero it. So the consumer converts probability to time by what it sent itself, with no second counter.

- `vad.reset` (a sound break) drops the accumulated tail shorter than a window and resets the LSTM state: sound before the break does not affect the estimate after it.
- `vad.end` runs the tail padded with zeros only inside inference, yields one probability with `samples` equal to the number of real samples, then resets the LSTM and answers `vad.ended`; a failure of this tail answers with an error carrying the request's `id` and `stream`. On the wire the stream may continue after `vad.end`, but the `SpeechDetector` port filler makes `end` the last action: after `vad.ended` it closes the probability stream, otherwise a consumer reading probabilities to the end would wait forever.

The port does not pass this real-sample count, and the core counts the last window as whole: a tail of up to 511 padded samples may enter the `Segmenter` duration thresholds. That is the port contract owner's decision; the clip itself is cut only by the sound the core has.

The host keeps the detector path bounded: sound sent but not yet covered by probabilities is at most 10 s per stream, and at most 256 unread probability messages; exceeding drops only that stream with a `DetectorBehind` refusal, without stopping stdout reading for the rest.
