---
id: 01a17a50-cec1-77d3-8660-4701d80415c7
title: "A project is renamed: graph storage is keyed on the project id, the name is only a label, update_project replaces set_project_policy"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/registry.ts
  - kind: file
    ref: apps/tagma/server/src/graph/storage/layout.ts
---
**Problem.** A project cannot be renamed: there is no operation. Adding one is blocked by the graph storage on disk being named after the display name — `graphs/<name>` (graph and `graph.git`), `mirror/<name>`, `set-aside/<name>-…` (`graph/storage/layout.ts`). For the same reason a deleted project's name stays taken forever ([[5e5f57fd]]). Threads, settings and journals are already stored by id; only the graph stands out.

**Who it touches.** Anyone who renamed a folder or repository, mistyped the name when adding, or split a repository: the project stays under the old name forever, and that name is the window URL's first segment ([[bc9d38bf]]).

## What comes

1. **Graph storage by project id:** `graphs/<id>`, `mirror/<id>`, `set-aside/<id>-…`. Every place that builds a storage path from the name receives the id. A step at server start, before graphs open, moves existing directories from the name to the id: directory by directory, only into an empty place, safe to rerun even after an interruption mid-way.
2. **`update_project { ref, name?, private?, strictProvenance? }`** replaces `set_project_policy`. The name passes registration checks: format (`project-name`), server paths (`reserved-project`), taken among live projects (`duplicate-name`). Renaming publishes a registry change. The policy CLI verb moves to this operation. Side-effecting actions — `set_project_root` and `set_project_storage` — stay separate operations.
3. **A deleted project's name is freed.** A deleted project whose name another took returns via `add_project` under the requested name.
4. **Window:** "Rename" in the project menu; open window addresses move to the new name on the registry event; window local state is not kept by name.

## Acceptance

- Move step: projects with name-keyed directories after start open their graphs from id-keyed directories; a rerun after a mid-way interruption completes the move and loses nothing.
- Renaming through the HTTP door: after it and after a restart the project's graph, worktree copies, mirrors and threads are in place; the new name addresses the project in operations and in the window.
- A new project can take a deleted one's name; a deleted one returning to a taken name takes the `add_project` name.
- A window open on a project address stands on the new address after renaming.
- The [[5e5f57fd]] and [[bc9d38bf]] explanations and the operation descriptions speak of the new arrangement.

Live check and server rebuild are the operator's; renaming the runlith project to `tagma` follows its restart.
