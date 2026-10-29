---
id: 01a127b8-b649-75e5-8006-ef59c7eb9c87
title: "App: a child from another project stands in the parent's Team marked with its project, and its feed opens in its project"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127b8-f971-7e57-85a5-b7de7f00e883",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features
---
Stage 3 of the spec. The server already serves `projectId` on roster/Team rows (`ThreadDirectoryRow`, commits `1957ab5df6`, `e620583471`); the child is born with home B (`8bbe29c2e4`). The app needs:
- in the parent's Team, a child with another home is shown marked with its project;
- its feed opens with the row's project (`ThreadPort.ts`), not the parent's project; answers, questions, and stops from that feed go to the child's home;
- a `[[name]]` reference to another project's block opens in that project — verify that after `8d80cd1c` this already holds, and finish the transition if not. Do not touch the chip editor (`ffabe318`).

Styling per the standard tokens (rule `55b5437b`). Done: state-owner unit tests (the row's project drives feed opening and actions) and a narrow svelte-check; a live showing — on one's own `tagma:try`, stopped at the end.
