---
id: 01a106df-fef1-7c88-b4f4-d4660e7c3024
title: Provider time maps onto the session scale through the segment's chunk capture times, so device clock drift needs no thresholds
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/engine/session.ts
  - kind: file
    ref: packages/speech/src/engine/timeline.ts
---
Adapter events carry the connection format's frames from its start. A segment (one connection) records into its `Timeline` the chunks sent after the resampler — the first frame and the monotonic capture time — and converts a provider frame into milliseconds from the host origin by seeking the nearest anchor on the left. A chunk becomes an anchor when its time departs from the previous anchor's continuation by half a millisecond or more, so the device clock's drift from the nominal rate accumulates no further than this precision and needs neither a drift threshold nor rebinding, and anchors are as many as the clock's drift, not the chunks.

So a new connection is always a new segment with its own frame scale: a gap, an overflow, a break and a planned change at the provider session's limit do not continue the old `Timeline`. The resampler tail (frames it holds until the next input) goes into the same segment before it closes, otherwise its time and audio would fall into another segment. Batch-model clips convert the same way: an event's time is frames from the clip's start plus its place in the segment's `Timeline` between gaps; anchors older than the oldest still-needed frame (an unprocessed clip or the `Segmenter`'s reach) are dropped there, because a gapless segment may last the whole track.
