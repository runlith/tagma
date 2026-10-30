---
id: 01a18d86-335d-758c-907c-4bb0a8febfff
title: "A group is a registration of its own kind: one group per project, dissolved below two members, its revision moved before its signal"
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/projects/groups.ts
  - kind: file
    ref: apps/tagma/server/src/projects/contract/service/changes.ts
---
A registration is one of three kinds: a folder (a project the user added), the global project, or a group. A group's own graph is a registration like any other, so the graph pool, storage, the graph remote and `project` fields serve it by its id with no group-specific path; its root is a folder in Tagma's data directory that holds no code, which is why removing it, re-pointing it, a team storage move and sources on its blocks refuse `group-graph` or `group-source`. Its name shares the project namespace because it becomes the first segment of its graph's addresses.

Membership is a row keyed by the member project, so a project is in at most one group by construction; the order is the group's order. A group exists only with two members: a leave or a removal that leaves one member dissolves the group, which marks its registration removed like a removed project instead of erasing it, so its graph stays on disk, and a group formed again under that name takes the registration and its graph back (`returned`).

Every membership change moves the registry revision first and only then publishes `ProjectChanges.grouped` with the members before and after: a subscriber that reads `ProjectGroups` inside its reaction already sees the state after the change, and one subscriber's failure stops neither publication. The registry imports nothing of who reacts.
