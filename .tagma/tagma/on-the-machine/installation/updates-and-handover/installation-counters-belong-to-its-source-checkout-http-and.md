---
id: 01a130f2-812e-7e99-880e-e7e3b4c21d97
title: Installation counters belong to its source checkout; HTTP and live hold one revision
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/composition/buildSource.ts
  - kind: file
    ref: apps/tagma/server/src/installation/builds/reading.ts
---
The distance to the running build belongs to the checkout it came from, so the page's project choice never changes these counters. HTTP and live receive one server projection together with the available actions; the "process instance + revision" pair shields the fresh value from a late answer, and a PID does not fit because the OS reuses it. An unreadable checkout or `package.json` arrives as a frame with an `issue` and never breaks the subscription: the fix brings the next frame on the same subscription. Observation opens before the first measurement and releases with the last subscriber. The cache is trustworthy while the watcher observes the checkout; on losing it a manual read measures the state anew, and recovery brings a fresh frame. That way tabs receive the same facts with no Git polling of their own.
