---
id: 01a16e6b-0d88-7512-a0ad-9fc8a449d398
title: Cheapen the demo build without swapping the app or Chromium
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-914e-70b9-91f7-523752eaac28",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
In `5daf024311` the bundle reuses unchanged statics by checked inputs; false invalidations from service files and shared maps fixed. Separate builds before: 43.71–50.38 s CPU; final hits — 0.73–0.77 s CPU and 0.51–1.18 s wall. Cold compilation remains: last sample 33.41 s CPU under load. Real app and Chromium kept, the final package script green on seeds 1–3; warm seed3 — 7.15 s CPU/11.41 s wall. The found late terminal-refusal miss fixed by waiting for the pane's first read; assertions and timeout unchanged. App typecheck green; the last shared typecheck demo command exits 1 only on a writing peer `external-harnesses/terminal/interrupts.test.ts` (`run` possibly null), no own demo diagnostics. Independent review dissected, held paths = 0. Full conditions, executions and measurements — x10/x-http.tsv and scratch demo-bundle-measurements.tsv; the comparable shared after stays with the runner.
