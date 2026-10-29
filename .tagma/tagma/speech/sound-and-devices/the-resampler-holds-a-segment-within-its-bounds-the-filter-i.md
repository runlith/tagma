---
id: 01a106dc-cb27-71db-bad7-dcb1d5729f85
title: "The resampler holds a segment within its bounds: the filter is centered, and `flush` releases the segment tail at a gap and at the end"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/audio/src/sound/resampler.ts
---
The filter is centered, not causal: output n is the audio at input position n·M/L, with no group shift. So the output time comes from the time of the chunk holding that position, and a resampled segment starts and ends where the original did. The price is half-filter latency: `push` holds the last input frames until more arrives.

`flush()` releases the tail, and `resample` calls it before every gap and track end. Without it the last milliseconds of every segment would be lost, and a reset without draining would smear audio across the gap through the filter.
