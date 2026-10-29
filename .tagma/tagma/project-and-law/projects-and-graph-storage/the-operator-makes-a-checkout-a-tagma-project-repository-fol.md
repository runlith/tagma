---
id: 01a14c14-a11c-7ce8-9d84-63201b6ba70d
title: "The operator makes a checkout a Tagma project: repository folder, graph storage, and dictionary directories"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6930741af75a
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6322e28e8883
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6324da5f3f35
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632a7054398a
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63363d3e5239
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NewProjectCatalogs.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NewProjectDialog.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/ProjectCreation.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/birth.ts
  - kind: file
    ref: apps/tagma/server/src/projects/cli/verb.ts
  - kind: file
    ref: apps/tagma/server/src/projects/registration.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/registry.ts
    symbol: REGISTRY_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/registry.ts
    symbol: REGISTRY_PAIRS
---
**Value.** A repository becomes a Tagma project in one step: its graph is born, and the commit gate stands in the checkout, so the project's law judges changes from the first commit.

**How.** The New project dialog in the window — folder, name, graph storage, stealth-graph remote, dictionary directories; on desktop, picking a folder creates the project at once. CLI `tagma project add`, the `add_project` operation. List and single record — `tagma project list|show`, `list_projects`, `read_project`.

**Behaviour.**
- A project is a folder that was added, with or without git. A second clone, fork, or project from the same template is a separate project with its own graph, threads, and settings, as is a folder copy together with `.git`. A worktree or subdirectory of an already registered repository doesn't become a separate project, and the folder of a project removed from Tagma doesn't birth a new one — it [[ee739244|returns]] with its graph and threads.
- The name becomes the first URL segment of the project and its worktrees' folder: names with path separators, the global graph's name, names taken by server paths, and another live project's name are refused. The graph on disk lies by project id, so the name is changed by `update_project` and the project's Rename menu item, while a removed project's name is free.
- Selected directories are kept as the project's own choice; an empty choice installs only the system library, no choice inherits the machine setting.
- The desktop fast path creates the project in stealth storage with machine directories; a refusal opens the dialog with the cause.
- `read_project` without a name answers with the project the call stands in.

**Limits.** The window sets only folder, name, storage, stealth-graph remote, and directories: private and strict provenance are set by CLI flags or `update_project`. Registration lays no law, skill, or foreign-CLI hooks into the repository — `tagma install` does that.
