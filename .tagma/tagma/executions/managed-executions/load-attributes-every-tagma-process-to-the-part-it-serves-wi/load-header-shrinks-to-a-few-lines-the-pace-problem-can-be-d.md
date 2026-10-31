---
id: 01a1929d-d770-7a71-aeab-887bb4e8511a
title: Load header shrinks to a few lines, the pace problem can be dismissed, and a removed project is no unread reading
ord: 8
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a19236-e2ce-7b34-8015-7c0e70df78a3
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadPanel.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadFigures.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadChart.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/PaceProblem.svelte
  - kind: file
    ref: apps/tagma/server/src/executions/load/work.ts
---
The operator: the header takes half the panel with little use. The spec's Header paragraph says what stays. The red "1 running process could not be moved to Low" callout has no dismiss once the level is saved (`PaceProblem.svelte` passes `onDismiss` only for an unsaved level). "Part of this reading was not read: projects: not-found: project 39 does not exist" comes from `executions/load/work.ts`, which counts `Projects.byId` refusing `not-found` as an unread reading: a held execution of a removed project is a fact, and its row stands without a project; whether such an execution should have been disowned on removal (`serving.ts` `disownProject`) is found and fixed at its owner.