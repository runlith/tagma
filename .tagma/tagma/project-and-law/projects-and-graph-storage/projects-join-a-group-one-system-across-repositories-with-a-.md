---
id: 01a18d86-3376-7adb-aa00-abfaf88b843f
title: "Projects join a group: one system across repositories, with a graph of its own, a start and law spanning every member, and one tile and agent list in the window"
ord: 12
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632c6aeb5d45
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633222b5a1a1
  - kind: relates
    to: 01a18d49-eba5-7e14-8517-20f9249b762f
sources:
  - kind: file
    ref: apps/tagma/server/src/projects/groups.ts
  - kind: file
    ref: apps/tagma/server/src/graph/operations/groups.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/groups.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/TileRung.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Grouping.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
  - kind: file
    ref: apps/tagma/server/src/thread-record/folders.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/place/Strip.svelte
---
**Value.** One system often lives in several repositories — a public product and its private cloud, a library and its consumer. A group makes Tagma treat them as one: an agent in any of them starts knowing the others and their law, the knowledge spanning them has its own home, and the window shows them as one place to work, while each repository keeps its own graph, law and storage.

**How.** `make_group`, `rename_group`, `join_group`, `leave_group`, `list_groups`, `read_group`; `tagma group make|rename|join|leave|list|show`. In the window: "Group with" on a project in the dock or the project list makes a group or adds the project to one, "Leave group" in the project list takes it out, and "Rename…" on a group's tile renames the group.

**Behaviour.**
- A project belongs to at most one group; the global project and a group join none. A group of two dissolves when one member leaves or is removed from Tagma; its graph stays on disk, and a group made again under that name takes it back.
- The group's graph is stealth in Tagma's data directory, with no remote until `set_graph_remote`; its blocks name no code and link to member blocks by edges; its rules bind every member.
- A member's thread starts with the global line, the group root, its own project marked as where it stands, then every other member with its top regions, within the project's one map budget; its law reads global, then the group, then each member's prompt rules under that member's name.
- A path inside a member checkout nested in another member's answers the nested member's owners and code rules.
- The dock shows a group as one tile with a mark per member, its badge and crest summing the members' activity; it opens into the member last entered. The agent list covers every member's threads, a row of any member but the first carries that member's mark, and moving between members keeps the list, its folders and scroll, while Files, Git and terminals follow the member.
- Thread folders belong to the group: a joining member's folders come in as they are, and a leaving member takes the folders its threads are filed in, a folder shared with the rest copied.
- In the worktree view each member's places are their own groups, in group order, and each thread stands in its own member's place. Wherever the window stands, a member's thread shows its worktree in the peek, and its menu moves it between that member's worktrees or to another project.
- A new thread's draft starts in the main checkout of the member the window stands in; the strip under the composer picks another member, and the draft goes there with its text and model.
- A project in no group sees no change.

**Limits.** A thread's home stays one project: moving one to another member is a move to another project.
