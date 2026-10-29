---
id: 01a145f2-c8f8-71e3-949c-46670e2874e9
title: The registry copy in the mirror is read in one snapshot through the machine base readers
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: syncRegistry
---
`MirrorBuilder.syncRegistry` reads the machine base registry in one query: `project` with a `left join` on `project_policy`, through readers (`MachineUnits.read`). So a tree refresh never queues on the machine base writer and goes through even while someone holds the writer.

Before there were two queries through the writer, and someone else's transaction could land between them: the mirror received a project policy with no `project` in its copy. One query gives one snapshot. The registry version is read before the query, so the snapshot is no older than the stamp, and a newer snapshot only triggers one more sync — nothing else.
