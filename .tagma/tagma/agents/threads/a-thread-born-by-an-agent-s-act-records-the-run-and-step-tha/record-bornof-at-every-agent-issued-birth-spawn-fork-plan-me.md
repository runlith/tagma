---
id: 01a0d136-c5cd-7ddb-b0e2-375737a0a3ab
title: Record bornOf at every agent-issued birth — spawn, fork, plan member, agent-asked root — and carry it on the list row as a by:step key
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d138-ddff-7591-b1c4-899dea7834d6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d136-c362-7db2-9eaa-907eddba1d6c
---
Build [[ddba1d6c]]: the `born_of` column and migration, `ThreadMetadataRow` and every storage adapter, the step number handed from the loop to the tool context, the write in `ThreadSpawnTree` births, plan member births, and Tagma's `ThreadActs` create and workflow start when asked by a thread; then the list row's `bornOf` key in `wire.ts#wireThread`. Done when the decision's acceptance holds; write the claims. Size: high.