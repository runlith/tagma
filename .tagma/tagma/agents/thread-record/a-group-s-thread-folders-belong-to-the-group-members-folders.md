---
id: 01a18d8c-a19c-7c29-90f6-7922742635de
title: "A group's thread folders belong to the group: members' folders move in on joining and split by whose threads they hold on leaving"
ord: 21
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18d49-eba5-7e14-8517-20f9249b762f
sources:
  - kind: file
    ref: apps/tagma/server/src/thread-record/folders.ts
  - kind: file
    ref: apps/tagma/server/src/thread-record/regroup.ts
---
A folder's `project_id` is the owner of the list it stands in: a project in no group, or the group a project belongs to. `member_id` names the member whose folder it is while a group holds it and is null for a project's own folder. Every folder door resolves the project it is called in to that owner, so a member's id and the group's own id reach the same folders, and a thread of any member may be filed into any of them.

- **Joining** — and forming, a group that takes back a dissolved group's graph included — moves every folder of each entering member into the group unchanged: same ids, nesting and order, its top-level folders after the group's. Two folders with one name stay two: a folder is its id, and names are not unique even within one project.
- **Leaving** — and dissolving, where every member leaves — gives each project the folders its threads are filed in. A folder holding threads of a remaining member and of the leaver stays with the group, and the leaver receives a copy of it, with its parent chain, holding its own threads. A folder whose threads all belong to the leaver moves out with its id. A folder holding no thread follows its member. Merging same-named folders was rejected: the same name may mean two things, and a merge could not be undone.

The reaction to `ProjectChanges.grouped` reads the membership the registry answers inside its own write, and the registry moves its revision before it publishes the signal, so the regrouping is driven by the state, not by the signal's lists: concurrent changes converge, and a crash between the registry's commit and this write is settled by the pass the service runs when it starts, which regroups every standing group and every dissolved group still owning folders. Only after its write does it publish `ThreadFolders.regrouped`, on which the thread list re-reads membership and resyncs the lists the change touched.
