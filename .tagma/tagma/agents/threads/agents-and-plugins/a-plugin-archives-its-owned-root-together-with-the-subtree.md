---
id: 01a123b3-b8cd-7701-8c87-60d0b02966b8
title: A plugin archives its owned root together with the subtree
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a123ab-f138-71e5-a304-1358f3764a88
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/operations/acts.ts
---
Ownership for `archive_thread` is set by `bindings.plugin`, the same plugin address as run-end delivery. Only the named thread is checked: its descendants count as its work, and reversible archiving keeps the group's usual semantics even with other bindings on descendants. This tolerance applies only to an external `plugin:<id>`; operator and agent paths keep their conditions.
