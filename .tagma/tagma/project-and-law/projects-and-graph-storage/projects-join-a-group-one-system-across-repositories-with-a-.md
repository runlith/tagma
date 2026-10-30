---
id: 01a18d86-3376-7adb-aa00-abfaf88b843f
title: "Projects join a group: one system across repositories, with a graph of its own and a start and law spanning every member"
ord: 12
tags: ["feature"]
fields:
  {
    "state": "partial"
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
---
**Value.** One system often lives in several repositories — a public product and its private cloud, a library and its consumer. A group makes Tagma treat them as one: an agent in any of them starts knowing the others and their law, and the knowledge spanning them has its own home, while each repository keeps its own graph, law and storage.

**How.** `make_group`, `rename_group`, `join_group`, `leave_group`, `list_groups`, `read_group`; `tagma group make|rename|join|leave|list|show`.

**Behaviour.**
- A project belongs to at most one group; the global project and a group join none. A group of two dissolves when one member leaves or is removed from Tagma; its graph stays on disk, and a group made again under that name takes it back.
- The group's graph is stealth in Tagma's data directory, with no remote until `set_graph_remote`; its blocks name no code and link to member blocks by edges; its rules bind every member.
- A member's thread starts with the global line, the group root, its own project marked as where it stands, then every other member with its top regions, within the project's one map budget; its law reads global, then the group, then each member's prompt rules under that member's name.
- A path inside a member checkout nested in another member's answers the nested member's owners and code rules.
- A project in no group sees no change.

**Limits.** The window does not show groups yet: no group tile, no agent list across members, no group folders (task [[ebc0e81a]]). A thread's home stays one project.
