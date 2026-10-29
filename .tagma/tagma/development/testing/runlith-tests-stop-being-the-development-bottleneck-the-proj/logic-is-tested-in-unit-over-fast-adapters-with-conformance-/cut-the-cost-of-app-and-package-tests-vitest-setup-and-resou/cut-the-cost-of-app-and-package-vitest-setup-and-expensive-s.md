---
id: 01a16df1-76fe-7242-a9ce-8b231b2b6b11
title: "Cut the cost of app and package Vitest: setup and expensive scenarios"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-5b26-7878-822b-21458858cf1f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b705a099f1ad
---
Vitest setup separated from window composition, fixtures narrowed, package suites run together; duplicate UI removed, Pane stabilized, Column made cheaper without raising the timeout. Baseline: app 106.3 s CPU / 44.1 s wall, packages 113.5 s CPU / 56.4 s wall. Point seeds 1–3 and typecheck green; the override-workers defect closed in 2714480289, Column in 1ac58937db. Commands, CPU, wall and queue recorded in x10/x-packages-vitest.tsv. A full green after and a ×10 win are not yet confirmed.
