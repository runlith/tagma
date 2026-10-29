---
id: 01a126b9-6a5d-780b-8049-42210911272b
title: "Journal shape steps per thread: list, mark, cast on serve and whole"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1267b-9010-7ed8-ab9d-f3fd930f4d29",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
---
The whole spec mechanism: a named step list from manifests, one mark per thread, cast of served records while the mark lags, whole-thread cast through the rollout file and return, stable fields for multi-thread queries, maintenance skipping uncast threads, cast on run recovery. The step list is empty for now: migration data steps and the current normalizer live until the baseline migration and are deleted by it, as is walking all rollouts after start. Each landing opens the operator's current store with no manual steps. Start with `threads/journal/rolloutForming.ts`, `rolloutEntryForms.ts`, `entryForms.ts`, `composition/manifest.ts`. Done when spec checks pass on a trial shape step.
