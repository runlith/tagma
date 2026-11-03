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

**How.** The Add project dialog in the window asks for the folder first and reads it (`read_folder`), then only what the folder cannot answer: a folder carrying its graph asks the name alone; any other folder asks name, graph storage and dictionary directories, or — where a module contributes a graph source — offers that source as a tab beside New graph. On desktop, picking a folder from the start screen creates the project at once. CLI `tagma project add`, the `add_project` operation. List and single record — `tagma project list|show`, `list_projects`, `read_project`.

**Behaviour.**
- A project is a folder that was added, with or without git. A second clone, fork, or project from the same template is a separate project with its own graph, threads, and settings, as is a folder copy together with `.git`. A worktree or subdirectory of an already registered repository doesn't become a separate project, and the folder of a project removed from Tagma doesn't birth a new one — it [[ee739244|returns]] with its graph and threads.
- The name becomes the first URL segment of the project and its worktrees' folder: names with path separators, the global graph's name, names taken by server paths, and another live project's name are refused. The graph on disk lies by project id, so the name is changed by `update_project` and the project's Rename menu item, while a removed project's name is free.
- Selected directories are kept as the project's own choice; an empty choice installs only the system library, no choice inherits the machine setting.
- A folder whose `.tagma` already holds a graph — a clone of a repository that carries one — is added over that graph: team storage, and the directories that graph holds become the project's own choice, so a machine default never adds to a shared graph. Asking stealth or directories for it refuses. A graph a module brings from elsewhere at birth keeps its directories the same way.
- The desktop fast path names no storage: a folder carrying its graph becomes a team project over it, any other a stealth one with machine directories; a refusal opens the dialog with the cause.
- `read_project` without a name answers with the project the call stands in.

**Limits.** The window sets only folder, name, storage, directories, and the fields a module contributes: private and strict provenance are set by CLI flags or `update_project`. Registration lays no law, skill, or foreign-CLI hooks into the repository — `tagma install` does that.
