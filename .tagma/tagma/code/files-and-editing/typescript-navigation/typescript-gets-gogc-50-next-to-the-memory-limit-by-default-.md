---
id: 01a161e6-2922-7654-b28a-0ed3d16d13a1
title: "TypeScript gets `GOGC=50` next to the memory limit: by default the peak was half garbage"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/launcher.ts
---
The Go collector by default (`GOGC=100`) lets the heap grow to twice the live data before the next collection, and on runlith the `tsc --api` peak in a question series was half garbage: 3.4 GiB of live heap at 5.4–5.8 GiB RSS. `GOGC=50` holds the ceiling at one and a half live volumes, and 0.7–0.8 s collections on four cores run alongside the questions without changing answer times.

`GOMEMLIMIT` — the holder's engine budget — works on top: when the live heap nears it, collections grow frequent, and on one core (`GOMAXPROCS=1`) one pass over a 3–4 GiB heap runs to 9 s — those are the multi-second pauses; so the holder never gives the engine fewer than three cores ([[2f766065]]). `GOGC=25` is not taken for this reason: it never pushes RSS under the limit, and on one core it stretches cold questions.
