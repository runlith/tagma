---
id: 01a14893-bf40-74cc-8e8a-b903475a615c
title: A long engine command (heavy-page snapshot) delays the "unresponsive" probe, and the engine refuses its own snapshot with page-unresponsive
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1484a-2e3b-77ca-b058-0914c4428b2f
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: packages/cdp/src/probe.ts
---
A browser-desktop measurement (one sample, the operator's Mac, Electron): a 24K-node page, `Accessibility.getFullAXTree` runs 2.9–5.4 s into the renderer and answers 33 MB. The `watchResponsive` probe (`packages/cdp/src/probe.ts`, 5 s threshold on managed and desktop) stands in the same renderer queue behind that command; in one run it crossed the threshold, the host reported `unresponsive`, and the engine guard (`browser/engine/drive.ts`) refused the snapshot itself with `page-unresponsive`. The same layout holds on managed.

From outside, the probe cannot tell "the renderer is busy with our command" from "hung on a page script". Simple exits break something else: pausing the probe for the length of one's own command leaves a hung renderer with no verdict and holds the page queue, while a larger fixed threshold is machine-dependent and delays an honest refusal.

What to decide: how the engine and the port tell their own long command apart (for example, an "own command in the renderer" holder on the port, under which the host judges the probe by that command's answer, or a heavy-page snapshot in parts — `Accessibility.getPartialAXTree`/`queryAXTree` over subtrees with answers below the threshold). Proof is a system scenario on a heavy page: the snapshot passes, while a real `for(;;){}` during a snapshot still refuses with `page-unresponsive`, and a reload brings it back.
