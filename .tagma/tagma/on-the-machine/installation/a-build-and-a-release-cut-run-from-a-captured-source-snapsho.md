---
id: 01a1a2ee-4df0-7950-86ed-67d0a7c1a24b
title: A build and a release cut run from a captured source snapshot, and the revision they record is measured on that snapshot
ord: 95
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee49a186ad90
  - kind: relates
    to: 01a1a2bb-6070-765d-ad16-10beda41e0db
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/snapshot.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/source.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/entry.ts
  - kind: symbol
    ref: apps/tagma/server/src/platform/git/readings.ts
    symbol: sourceTree
---
A build or release cut takes minutes, and shared checkouts move under it: peers edit and commit, and the build's own steps rewrite generated files. A producer reading the live checkout would mix generations and label the result with a revision it was not built from. So `tagma:build`, `tagma:build --tree` and an uncut `tagma:release` first copy their source into a disposable detached worktree, install its frozen-lockfile dependencies there and re-run the entry inside it. The child learns the snapshot root, the captured revision and the original checkout from the environment.

**What a tree capture carries** is an inclusion list: git-tracked files, untracked unignored files, and the ignored files the distribution names in `inputs`. Everything else that is ignored — caches, build outputs, `.env` and other secrets — stays out. A rule that excluded known junk instead would copy every ignored secret it did not anticipate. Submodules are captured at their pinned commit for HEAD builds and at their own HEAD plus working tree for tree builds. Links must be relative and stay inside the checkout, so the copy never points back into the live tree.

**The recorded revision is measured on the snapshot** with the same `sourceTree` reading the checkout-builds offer uses on the original checkout, with the same declared inputs. The installation therefore reads as current exactly when the checkout still matches what was built. The fingerprint hashes each path that differs from HEAD by its content (`hash-object`) and executable bit, never size and mtime, so a same-size edit to a declared input counts. It ignores what is staged, because the snapshot holds the same files without the original's index.

**Release reuse skips the capture**: `notarize`, and a `publish` whose HEAD already has a cut or release, run directly, because they read the standing cut and no source. A release is cut only from a clean HEAD.
