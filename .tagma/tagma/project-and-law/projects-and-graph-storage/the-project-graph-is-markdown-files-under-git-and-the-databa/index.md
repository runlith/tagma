---
id: 01a14c14-a11c-7ce8-9d84-6328ba8c9922
title: The project graph is markdown files under git, and the database is their mirror
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69419b982509
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/projects.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/twinning.ts
  - kind: file
    ref: apps/tagma/server/src/graph/storage/identity.ts
  - kind: file
    ref: apps/tagma/server/src/graph/storage/identity.worker.ts
  - kind: file
    ref: apps/tagma/server/src/graph/storage/retirement.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/blockFile.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/duplicates.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/fallen.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/mirror.ts
---
**Value.** Knowledge outlives the database, travels by git, and reads in any editor: a lost mirror rebuilds from files, and a deleted file doesn't destroy a block without a trace.

**How.** Automatic. `tagma files log <block>` — the block file's history; `rewrite_graph_files` rewrites all block files in the current form.

**Behaviour.**
- Every block is its own tree markdown file; edges are written in canonical order, so identical knowledge yields identical bytes.
- Repeated identical source entries on a block in a file represent one source, including when git combines them during a merge.
- A file leaving the tree takes its block to the trash with a journal event, and `restore_block` brings it back; a returned file revives the block.
- Two files with one id is a refusal naming both paths; the graph doesn't read until the copy is removed.
- An old-form tree passes the graph's form steps on open.
- `rewrite_graph_files` touches only files whose bytes change, and changes no block; a repeated call writes nothing.

**Limits.** The mirror migrates on open; a mirror below the baseline mark rebuilds from files without its former journal, trash, and snapshots. Background cleanup deletes a mirror only by recorded project id and tree root: for team, both the worktree record in git and the served branch must go; for stealth, the cleanup-removed tree and its twin. A branch rename keeps the mirror's link to it even without opening the graph. A missing folder with a live git record or branch, a mirror without identity, a mirror awaiting current baseline-form confirmation, and a mirror of a deregistered project are kept. `rewrite_graph_files` is called only by hand; the server never calls it. Its description names `sync_graph` as what will commit the rewritten, but in stealth `sync_graph` refuses; the operation's declared refusal list doesn't name two refusals its execution answers with (tree unserved, tree mid-merge).
