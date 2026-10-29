---
id: 01a17d53-1292-72b9-8116-28be74d1f34a
title: A dev front counts as answering only by the `/@vite/client` script, and `start_dev_surface` never keeps two of its own Vite instances
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-builds/surface.ts
---
A dev front counts as answering only on the `/@vite/client` script, and `start_dev_surface` never keeps two of its own Vite instances.

Any HTTP answer on the dev port is not yet Vite: the port may belong to someone else's process, and a static server with an SPA fallback answers `200 text/html` on any path. Only the JavaScript on Vite's own client path counts; someone else's process is never taken, and a started Vite falls on `strictPort`, with the call refusing `dev-surface-ended` carrying its output.

Calls go one at a time, and an attempt started by a call outlives it: the held terminal lives on even if the call broke off while Vite was rising. The next call on a silent address waits for the same attempt, and an indeterminate start first reads back on its operation key and starts a new one only once the previous one's absence is proven. Otherwise a second Vite would fall on the busy port and the call would refuse, though the first one is about to answer.
