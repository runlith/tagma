---
id: 01a18d86-336f-7de2-b13f-8260a36ba013
title: "A group's graph is born stealth and names no code: sources and a team move refuse, edges reach member blocks"
ord: 257
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/grouping.ts
  - kind: file
    ref: apps/tagma/server/src/graph/sources/placement.ts
---
A group's graph is born with the group: stealth with Tagma's own git, its root folder in the data directory, the machine's catalogs, and no remote until `set_graph_remote` gives it one. It stays stealth — a team move refuses `group-graph`, since no repository could carry it, and a member's repository never names the group or another member.

Its blocks carry no sources: a source is a path inside one checkout, and the code it names is owned in the member holding it, so `Sources.place` — the door every new source passes — refuses `group-source`. A group block reaches member blocks by edges, which already cross projects, and its rules are prompt rules.

Forming, joining and leaving are journaled in the machine graph as registry acts: the group's birth as `project_add`, each membership change as `project_set` of the field `group`, a dissolution as `project_remove` of the group.
