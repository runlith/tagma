---
id: 01a14c14-a11c-7ce8-9d84-6324da5f3f35
title: The project graph is stored in team or stealth and moves between them with one command
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6325d41fd6a2
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632614955e6b
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6328ba8c9922
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/projectStorage.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/GraphFilesSection.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/storage/layout.ts
  - kind: file
    ref: apps/tagma/server/src/graph/storage/move.ts
  - kind: symbol
    ref: apps/tagma/server/src/projects/contract/wire/project.ts
    symbol: STORAGE_MODES
---
**Value.** The team decides whether colleagues see the graph: in team it travels in the repository with the code; in stealth the repository carries no Tagma files.

**How.** Choice at registration — the New project dialog, the `--storage` flag. Moving — `tagma project storage <project> <mode>`, the `set_project_storage` operation. Settings → Graph files shows the tree and offers to copy the moving command.

**Behaviour.**
- Team: the block tree is `.tagma` inside the checkout under the project's git, on its branch.
- Stealth, the default mode: the tree and Tagma's own git lie in the data directory, apart from project files. A folder without git has one tree; when git appears, the graph follows checkouts and branches, keeping twin branches.
- Moving carries the whole tree and keeps the mirror with its journal. A new open waits for the move to finish. In stealth, files commit into Tagma's git; in team they stay in the checkout until committed under the `graph.commit` policy.
- Moving refuses if the target already holds a tree, the source tree is mid-merge, or another copy of the project still holds its graph. A stealth move requires a named branch if the folder has git.
- The global project is born stealth and changes storage mode on common grounds; its working folder stays in place.
- A group's graph is born stealth and stays stealth: no repository could carry it.

**Limits.** The window doesn't move the graph itself — it copies the command. Moving to team removes private. A team graph travels with the code repository.
