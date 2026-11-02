---
id: 01a14c14-a11c-7ce8-9d84-6321ee739244
title: A project moves to another checkout or leaves Tagma without deleting anything from disk, and returns with its graph and threads when its folder is added again
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63201b6ba70d
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63363d3e5239
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Removal.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/RemoveDialog.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/serving/removal.ts
  - kind: file
    ref: apps/tagma/server/src/projects/resolution.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/commits/hooks.ts
    symbol: uninstallCommitHooks
  - kind: symbol
    ref: apps/tagma/server/src/projects/registration.ts
    symbol: projectsLayer
---
**Value.** A moved repository continues the same graph, and a project not needed right now leaves the list, as from an IDE, and returns whole when its folder is added again.

**How.** In the window — "Remove from Tagma…" in the project context menu (dock and tabs), in the top-bar project list for the open project, and in the palette; the confirmation says nothing is deleted from disk. `tagma project set-root`, `tagma project remove`; the `set_project_root`, `remove_project` operations. Returning is ordinary folder adding: New project, folder pick in desktop, `tagma project add`, `add_project`.

**Behaviour.**
- The new root must not belong to another project; the commit gate is installed into the new checkout.
- Removal requires nothing to be cleaned: the graph in any storage, threads and their journals, settings and notes stay. The project's running agents stop, the project's graph and MCP servers close.
- Removal takes the commit gate and merge driver out of the checkout if no other registered checkout shares them, and puts back the hooks the gate had pushed aside.
- A removed project is visible neither in the list nor by name, id, or directory, nor in cross-project search, and its threads leave "Attention"; other projects' edges into its graph read as off this machine.
- The same folder, or this repository moved elsewhere (`mv`), brings the project back with its former id, name, policy, and storage; entered name, storage, and directories don't apply to it, and the window says the project has returned. Likewise, adding a moved repository of a standing project moves the project to the new place. Another clone or folder copy is a new project; a folder without git is moved with `set_project_root` after the move.
- A removed project's name stays with it: no other project registers under that name.
- The global graph can be neither moved nor removed.

**Limits.** Moving isn't offered in the window. Removal doesn't take down background commands of threads with no running turn. Removal is declared destructive and in review mode asks the operator.
