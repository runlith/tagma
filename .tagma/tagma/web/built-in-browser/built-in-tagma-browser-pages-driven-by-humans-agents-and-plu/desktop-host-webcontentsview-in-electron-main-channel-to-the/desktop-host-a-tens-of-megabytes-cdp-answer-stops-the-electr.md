---
id: 01a148a7-c885-7136-81c3-abbff168d3f7
title: "Desktop host: a tens-of-megabytes CDP answer stops the Electron main event loop for over a second"
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a147d6-7ef4-7c9c-9e39-feab93cb7437
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/connection.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/driven.ts
---
Measurement (one sample, macOS arm64, Electron 44.8.0, recorded in [[93cb7437]]): in a loop of full snapshots of a ~24k-node page, the `Accessibility.getFullAXTree` answer weighs 33 MB, `JSON.stringify` of the answer in main takes 28–91 ms, and peak main timer lag is 1343 ms. Main also drives input of all Tagma windows, so the window stands still for that long.

The answer passes through main three times: Electron turns it into a JS object (`webContents.debugger.sendCommand`), `Driven.command` serializes it, `framed` glues another copy and slices it into pieces. Which stage gives the second-long peak, the measurement did not separate: the first is inside Electron and unfixable through the `debugger` API, the second and third can be cut.

Start by measuring per stage on the same page. If the peak is inside Electron, the fix is a CDP road past main (e.g. its own renderer or debug-process channel), and that is a decision of the [[255c4582|spec device]], not a host fix. Done when main lag on this loop stays within a frame, or the decision is recorded in the spec.

Per-stage measurement: one sample, macOS arm64, Electron 44.8.0. Main timer ticked every 5 ms, the host measured its own stages; the probe is not saved. The engine snapshot in uncommitted form [[475a615c]] walked the tree via `Accessibility.getChildAXNodes` on a ~24k-node page.
- A 1.7 MB answer stopped main for 190–230 ms. The stop ended at host-callback entry, i.e. it fell on translating the answer inside Electron. The callback itself was `JSON.stringify` 2–52 ms plus slicing and sending 2–39 ms.
- That is ~0.1 s per MB, consistent with the earlier 1343 ms peak on a 33 MB answer.
- The walk ran at 300–650 commands per second and did not fit in 45 s. Main stood the whole time with 40–230 ms lags.
The decision is recorded in the [[255c4582|spec]]: CDP stays in main via `webContents.debugger`, the engine that spawns it carries the cost. The host cut none of its own copies: they are under a tenth of the stop.
