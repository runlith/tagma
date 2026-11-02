---
id: 01a1805a-1f26-7e78-975f-db2cccba6116
title: "Stealth blocks in a team project: part of the graph lives outside the repository, and the agent works with one graph"
ord: 127
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6324da5f3f35
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6325d41fd6a2
  - kind: relates
    to: 01a17f5f-3c8d-78c2-b6c7-2ab1c11265c5
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/storage/layout.ts
---
**Why.** Storage is now chosen for the whole graph. A team graph lies in `.tagma` and travels with the code, so knowledge a team keeps to itself cannot go there: vendor terms, money-related decision reasons, pre-announcement plans, a developer's notes about the company's working repository. Keeping such knowledge in another project leaves the agent without it: law and explanations for a place in the code arrive only from the graph of the project owning the file (`orientation/touches.ts`: `touchLaw(projectId)` over its own graph). It cannot go into global either: global's rules reach every project and never bind to code. Whoever started with stealth — the default storage — publishes the whole graph at once on moving to team; only a manual teardown separates the private.

An open-source project backed by a company needs this; a developer with personal notes in someone else's repository; any team with inside knowledge about code everyone sees.

## Model

- Every project has a stealth tree in the data directory, under Tagma's own git (`graphs/<id>`: `graph.git` for a stealth project, `layer.git` for a team project's stealth blocks). A team project also has `.tagma` in the checkout. Each block lies in exactly one of the two trees — that is its storage, `team` or `stealth`. There is no new word: stealth on a block means the same as on a project — "lives at your home, the repository carries nothing".
- A project's storage is its root's storage. A new block is born in its parent's storage unless the act named another. A stealth block's descendant is always stealth. In a stealth project everything is stealth; in a team project only the subtrees made stealth.
- For reading it is one graph. One mirror per checkout absorbs both trees, so search, owners, edges, law delivery by place, `ready_work`, and orientation work as now and must not change. A file-bound stealth rule reaches the agent that opened that file.
- A project without stealth blocks pays nothing: the second tree, its watcher, and git appear together with the first stealth block.

## Layer law: the team layer stands alone

A repository clone without a data directory must read the whole team layer — the same as a machine with the stealth layer. The stealth layer only adds knowledge and never changes team blocks' meaning.

So a write after which a team block depends on a stealth block refuses `stealth-dependency` and names both blocks. Three ways out: make the depending block stealth, move the target to team, or drop the dependency. Counted as a dependency:
- parent;
- an edge of any kind;
- a reference field: the debt owner in a rule document, catalog `tags`, a view's scope and query edges, an amendment's `ops`;
- a `[[name]]` link in the body;
- a tag declared only in the stealth layer.

The reverse is allowed: a stealth block stands under a team block, links to it, and connects by any edge — except `supersedes`. A replacement declares the team block obsolete, which a clone would never see, so it refuses `stealth-supersede`.

A `#module` card is never stealth (`stealth-module`). The module map judges a commit identically on every machine and in CI. A stealth card would change public modules' territory only where the layer exists. A stealth rule with a check is allowed: it only adds verdicts and judges where the layer exists.

A team project's root changes storage only together with the project, through `set_project_storage`.

## Acts

- `create_block` and `create` in `apply_batch` accept `storage`; without it the block takes its parent's storage.
- `set_block_storage` (and the `storage` op in `apply_batch`) moves a block with its subtree.
  - Moving to stealth refuses while team blocks lean on the subtree, and names each.
  - Moving to team refuses while the subtree leans on stealth blocks outside itself.
  - Edits of the depending blocks and the move land in one `apply_batch`. Publishing a subtree that stays partly stealth goes the same way: one batch moves to team and moves that part back. A batch is one act, so a committed `.tagma` never holds an intermediate state.
- The move writes the block into the target tree first and only then removes it from the source — a subtree moves between graphs the same way ([[c82c927b]]). A break leaves the block in both trees with a `duplicate-identity` refusal naming both paths. The block never vanishes from both.
- A move-to-stealth answer names blocks whose files already stand in repository commits: their old versions stay in history, and Tagma never rewrites it.
- Reads answer a block's storage. `read_block`, `query_blocks`, and `search_blocks` rows carry `stealth`; `query_blocks` selects by storage — showing what is held outside the repository.

## What a human sees

- A stealth block's row and page carry the same mark and word the stealth project carries now (`EyeOff`, "Stealth").
- Block creation offers a storage choice, and a block can move to the other.
- A team project's Settings → Graph files shows both trees and the Remote card.
- A layer-law refusal shows the depending blocks as links.

## Branches, worktrees, remote

- A team project's stealth tree runs on the same machinery as a stealth project's graph ([[d41fd6a2]]): each checkout its own tree, each code branch its own twin, and a twin merges when code merges. A stealth spec written on a feature branch reaches main with that branch's code, no earlier.
- Writing a stealth block on a detached HEAD refuses the same as in a stealth project today.
- `set_graph_remote` accepts a team project: its remote carries the stealth layer. That is an off-machine copy and a shared layer for those with remote access; the rest see only the team layer. Registering a team project with `--graph-remote` raises the layer from the remote.

## Project storage

- team → stealth: `.tagma` merges into the stealth tree, all blocks become stealth, and none is lost.
- stealth → team: `set_project_storage` takes `keep`, the subtrees staying stealth; the rest moves into `.tagma`. The stealth tree stays with the layer, history and remote included: with `keep` or a graph remote, `graph.git` becomes `layer.git`. Without either everything moves, as now.
- team → stealth turns `layer.git` into `graph.git` where none stands, so the stealth graph keeps the layer's history and remote.

## Files

- The `.tagma` shape never changes: team blocks only. The file name and the `p.md` vs `p/index.md` choice count only team neighbours and team children. Now the projection counts both over all mirror rows (`tree/projection.ts`: `shelfNames` over all of the parent's children, `childCounts` over all children). Left as is, a stealth child would turn `p.md` into `p/index.md` or rename neighbours, and a public commit would reveal a stealth block standing nearby.
- A team project's stealth tree is a forest. A team block's stealth children lie in a top-level directory named by that block's uuid; inside — the plain shelf of its stealth children, nested by directories as now. The block file itself keeps its shape: the directory names the parent, not a new field. A stealth project's stealth tree has one root and no anchor directories.
- A team project's forest lives in `graphs/<id>/layers/<checkout tree>` under its own `layer.git`, beside `graph.git`. A Tagma that does not know the forest never opens `layer.git`, so the forest needs no graph-format step.
- A team parent that vanished from `.tagma` through someone else's commit takes no stealth children away. They stand under the root, their files staying in the former parent's directory. The page names the block displaced; if the parent returns, so does the block. Tagma itself writes nothing over a change made where the layer is unseen. Deleting a team block by an act on a machine with the layer takes the whole subtree as now, stealth children included, in one trash batch.

## Commits

- An act over stealth blocks commits into Tagma's git, like a stealth project's act today. Neither file nor commit reaches the code repository.
- A code commit carrying a stealth task's work never names it, neither in the subject nor in trailers. Now `landing/land/message.ts` appends every task's name. The task-to-commit link stays in the journal through `finish_block`.
- `.tagma` commits name only team blocks; that covers the meaningful graph-commit messages from [[c11265c5]] too.

## Where the code changes

- `graph/storage/layout.ts`: a checkout resolves to a set of trees, not one. The team project's mirror stays under the `.tagma` key, so standing mirrors never rebuild.
- `graph/tree`:
  - mirror scan, watch, repair, and rebuild over two trees — the block path together with the tree;
  - projection by block storage, anchor directories, and naming by own-tree neighbours;
  - the ledger of its own writes per tree.
- `graph/serving`: a graph copy holds both trees — write-through, team-tree commits, commits, twins, and remote of the stealth tree.
- The layer-law gate is one, in the graph write layer. It judges every write: act, batch, amendment admission, subtree arrival from another project. No operation carries its own check.
- `graph/storage/move.ts` and `set_project_storage` take the subtree list; `graph/storage/remote.ts` and `set_graph_remote` accept a team project.
- `landing/land/message.ts` names only team tasks.
- App: the storage mark, choice at creation, the move, Settings → Graph files.

## Limits

- This is not access control. Anyone with the machine's data directory or remote access reads the stealth layer.
- The past never hides: block versions committed before a move to stealth stay in repository history.
- Edges from other projects into stealth blocks stay addressed, as now. Where there is no layer, they read "not on this machine".
- A stealth rule with a check judges only on machines with the layer. CI and colleagues without remote access never know of it.
- A branch's layer twin merges without levelling: graph steps level a branch's team twin, never its layer twin.
- A detached checkout reads the team tree alone.
- A team → stealth move where `graph.git` already stands folds the layer's blocks in without the layer's history; that history stays in `layer.git` on disk, and a graph remote that held the layer then holds another graph.

## Acceptance

1. In a team project, stealth-block birth, edits, in-layer moves, and deletion change not one byte under `.tagma` and produce not one commit in the code repository.
2. A team shelf's stealth child changes neither its file's path nor its neighbours' file names.
3. A fresh clone without a data directory reads `.tagma` with no dead edges, unresolved links, or unknown tags leaked from the stealth layer.
4. An agent opening a file receives the stealth rule and stealth explanation bound to it. `search_blocks`, `read_owners`, and `query_blocks` find stealth blocks together with their storage.
5. Every layer-law dependency refuses with its own code and with way-outs; stealth-to-team `supersedes` and a stealth `#module` refuse.
6. Moving to stealth a subtree team blocks link to refuses and names them. A batch with edits and the move lands, and no `.tagma` commit holds an intermediate state.
7. A stealth block written in a branch worktree appears in main after that branch's `merge_worktree`, no earlier.
8. A second machine with the same remote receives the team project's stealth layer, while a machine without it sees only the team layer.
9. A team parent deleted by someone else's commit leaves the stealth child standing, and Tagma writes not one file for it.
10. A code commit with a stealth task's work never names it; `.tagma` commits never name stealth blocks.
11. A stealth → team move with a list leaves the named subtrees out of `.tagma`; a team → stealth move loses not one block.
