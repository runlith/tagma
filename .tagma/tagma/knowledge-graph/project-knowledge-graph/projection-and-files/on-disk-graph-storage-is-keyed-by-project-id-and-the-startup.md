---
id: 01a17a99-c409-70b8-b460-ee77bb930a1b
title: On-disk graph storage is keyed by project id, and the startup step moves name-keyed storage once, directory by directory and only into an empty place
ord: 13
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17a50-cec1-77d3-8660-4701d80415c7
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/steps/storageById.ts
  - kind: file
    ref: apps/tagma/server/src/graph/storage/layout.ts
---
The project name is a label that can be changed and that another project may take after the project's deletion, while graphs, mirrors, and the set-aside copy under `restore` live in `graphs/<id>`, `mirror/<id>`, and `set-aside/<id>-…`. Name-keyed storage made renaming impossible and a deleted project's name forever taken: a new project would open a foreign graph.

The `storageById` step moves the old name-keyed storage once in `GraphSteps.prepareStorage`, before any graph opens, once per install (a `meta` mark), for every registry row, deleted ones included. The `graphs/<name>` and `mirror/<name>` directories move whole in two phases: first each to `graphs.moving/<id>` and `mirror.moving/<id>`, then, after the `…:staged` mark in `meta`, from there to `<id>`. A project name may match another's id; without the intermediate place, one directory already standing on `<id>` would be taken on the next pass — or a repeat after a break — for another's name directory and carried to it. The mark splits the phases: after it a `graphs/<number>` directory is nobody's by name, and the first phase does not repeat. Every move goes only into an empty place; a taken place refuses the start, keeping both copies.

Then the step brings up what holds absolute paths and tree-root keys — without it the graph at the new place would open foreign or empty:
- the `.git` pointers of trees and recovery trees, `worktrees/*/gitdir` and `config` in `graph.git`, then `git worktree repair`;
- `tagma-checkouts`, `tagma-served`, `tagma-merges`, and `tagma-retired` records keyed by tree-root hash — under the new root hash;
- stealth-tree mirror files named by root hash, their migration snapshots (`store` in the snapshot document, the copy inside the snapshot), and identity in the mirror.

The step can be cut anywhere: every rewritten file lands whole by replacing a finished copy, and the next start derives the old paths again from the tree-directory names and does only what is not done. So a tree-directory mirror file that left `trees/` moves before its `tagma-retired` record is rewritten — after it the old root is unreadable. A moved mirror loses its cold-read basis (`tree-basis`): the watcher mark stands at the old path, and a tree edit made before the move with a stopped server cannot be seen by it.

Outside the step stay the `set-aside/<name>-…` set-aside copies, which nobody reads back, and the project's `worktrees/<name>` worktree folder: those are the user's checkouts, not graph storage, and new worktrees after renaming land in the new name's folder.
