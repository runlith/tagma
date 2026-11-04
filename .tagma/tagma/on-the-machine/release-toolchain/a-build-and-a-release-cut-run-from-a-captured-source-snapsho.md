---
id: 01a1a2ee-4df0-7950-86ed-67d0a7c1a24b
title: A build and a release cut run from a captured source snapshot, and the revision they record is measured on that snapshot
ord: 2
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee49a186ad90
  - kind: relates
    to: 01a1a2bb-6070-765d-ad16-10beda41e0db
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/entry.ts
  - kind: file
    ref: apps/tagma/server/src/cut/snapshot.ts
  - kind: file
    ref: apps/tagma/server/src/cut/source.ts
  - kind: symbol
    ref: apps/tagma/server/src/platform/git/readings.ts
    symbol: sourceTree
---
A build or release cut takes minutes, and shared checkouts move under it: peers edit and commit, and the build's own steps rewrite generated files. A producer reading the live checkout would mix generations and label the result with a revision it was not built from. So `tagma:build`, `tagma:build --tree` and an uncut `tagma:release` first copy their source into a disposable detached worktree, install its frozen-lockfile dependencies there and re-run the entry inside it. The child learns the snapshot root, the captured revision and the original checkout from the environment.

**What a tree capture carries** is an inclusion list: git-tracked files, untracked unignored files, and the ignored files the distribution names in `inputs`. Everything else that is ignored — caches, build outputs, `.env` and other secrets — stays out. A rule that excluded known junk instead would copy every ignored secret it did not anticipate. Submodules are captured at their pinned commit for HEAD builds and at their own HEAD plus working tree for tree builds. Links must be relative and stay inside the checkout, so the copy never points back into the live tree.

**One inventory decides what is copied and what is measured.** `sourceInventory` lists, against the captured commit, the paths `diff --raw` names, the untracked unignored files (an untracked nested repository by its own listing) and the declared inputs, with each path's state in the commit; submodules carry their own inventory. The capture first removes every listed path that no longer stands as a file or link, then copies the ones that do, so a file turned directory and a staged deletion land right, and only changed paths are copied over the HEAD checkout. `measureSource` applies that inventory to the snapshot, and the checkout reading applies the same function to the original. A path counts as changed only when its content (`hash-object`) or its type and executable bit differ from the commit, never by size, mtime or what is staged. So an edit staged and then undone in the working file reads clean on both sides, and a nested repository that the parent's ignore rules would hide after flattening still measures the same. The installation therefore reads as current exactly when the checkout still holds what was built.

**Declared inputs are watched on their own.** The checkout watcher skips directories git ignores whole, so the source follower also watches each declared input's directory without recursion. An edit to an input then re-reads the checkout like any other edit.

**Release reuse skips the capture**: `notarize`, and a `publish` whose HEAD already has a cut or release, run directly, because they read the standing cut and no source. A release is cut only from a clean HEAD.
