---
id: 01a17b1a-88ee-78a1-83bf-11cfedd30011
title: The judgment reads an installed-package config from the judged checkout, the same for base and tree, and the importer index verifies its fingerprint
ord: 36
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a17af6-3ba7-7537-a6fe-d15e65ed63b7
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/probes.ts
  - kind: file
    ref: packages/code-facts/src/languages/js/config.ts
  - kind: symbol
    ref: apps/tagma/inspection/src/core/node/sides.ts
    symbol: environmentOf
  - kind: symbol
    ref: apps/tagma/inspection/src/packs/js/platforms/walk.ts
    symbol: readSlice
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
    symbol: checkoutFile
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/workers/sides.ts
    symbol: sideTree
  - kind: symbol
    ref: packages/code-facts/src/languages/js/workspace.ts
    symbol: input
  - kind: symbol
    ref: packages/code-facts/src/tree.ts
    symbol: submoduleOf
---
TypeScript resolves `extends` by package name through `node_modules`, and such a config has no committed source: `@tsconfig/node22`, `astro/tsconfigs/strict`, a shared company config, a package from a neighbouring folder linked in. So an installed package is the checkout's environment, not judged code, and the judgment reads it the same way TypeScript does in that checkout. A copy via `built` is unneeded here and would be worse: it would have to be kept in every repository and verified against every reinstall.

- Both sides of the change, base and tree, read one and the same installed file. A reinstall never becomes a change under judgment and never shifts a landing's verdict; the next measurement finds a new standing violation from it.
- A path missing from the tree, from `built`, and from workspace members is read from the environment when it lies inside a `node_modules` directory, outside the checkout, or inside a submodule declared by the judged tree's `.gitmodules`. A missing path inside the checkout but outside `node_modules` and submodules stays under the `built` contract ([[a71f4364]]): the judgment still never reads a generated file from the working directory. A package that is itself a workspace member is read from the tree as judged code, while a `built` output on an installed path stays its own copy: `realpath` does not lead it away, otherwise the copy would read from the store directory and verification against it would break.
- A submodule is someone else's repository inside the checkout: in the git tree it stands as a single gitlink entry with no files. The judgment reads its files as the checkout holds them — as an installed package, not as its own code. A gitlink shift is a reinstall to the judgment: both sides read the same thing. The judgment resolves submodule paths from the judged tree's `.gitmodules`, not from disk. So a submodule not fetched in the checkout refuses under its own name with the `git submodule update --init` way out, instead of falling into the `built` contract.
- A link is followed to where it leads, and the chain resolves further from there, as in TypeScript: in bun isolated and pnpm layouts a package's dependencies lie next to its real directory, while with `npm link`, `file:` and a neighbouring-folder package they lie outside the checkout. So the TypeScript host walks the ancestors of the real place, its path space is mounted at the depth of the checkout's real root, and a path outside the checkout is a tree path with leading `../`. A tree file's nearest tsconfig is searched only inside the checkout: the verdict never depends on where the clone lies.
- A package that is not installed refuses `UnsupportedSource` naming the config and whatever its chain names, with installing the checkout's dependencies as the way out. A tree with no environment reader refuses in the old words: such a read has no environment.
- The `modules` importer index stores in `members` the fingerprint of every installed path resolution touched — present or missing — as an `installed`-kind input with the hash of the real place and text. Before the index is used, fingerprints are verified against the environment, and rows watching a changed path (`p:<path>`) are re-derived. Without this, stale rows after a reinstall gave a landing's base side the old resolution, and an unchanged importer received a false new violation. The index is shared across a repository's worktrees: when their installs differ, rows are re-derived on every worktree switch.
- Both sides read one environment within one judgment: the worker holds what it read in a pass map shared by the sides, the inspections CLI in one reader per measurement, so a reinstall mid-judgment never splits base and tree apart.
- In the inspections worker, an installed file is read by the same checkout reader as the generated file for copy verification. An unread path is recorded as asked and answers as missing until the retry, like an unread tree blob. A pass that asked anything is discarded whole: its memo, index and reads are not kept. The worker reads the asked paths and repeats the pass. So one pass gathers everything it may ask, and an `extends` chain costs one retry per level, not per probe or memo entry. If reading threw, the pass would break at the first path, and a cold judgment would pay a retry for every missing path, whose count grows with the package count.
- `platforms` judges in parts: each side is a plan and slices in separate asks, possibly on different workers. So one judgment's environment is pinned across asks, like `compared`: the answer names the installed files its pass read, the server hands the accumulation to the following asks and to the built side. A worker's memory of frontiers and plan snapshots lives for one judgment, not the caller's task: a trusted frontier skips fingerprint verification, and one environment holds only the judgment. A gate retry after commit steps or a rebase onto a new HEAD is judged anew. Plan and slices read the checkout the judgment named (on merge — the worktree), not the project root. A config that failed to parse still contributes its probes to the resolution inputs. So an unresolved from an uninstalled package is remembered with the missing paths' fingerprints and re-derived once the package is installed. `platforms` memo stores these files' fingerprints in a separate `installed` field, as the package's contribution too. `validMemo` verifies them on every check, even when the entry stands in `Validity`: that one carries validity over tree diffs, and a reinstall never changes the tree. A stored tree read is taken only while the fingerprints its side read still match. Without these verifications, a landing's base side after a reinstall served the old read or the old walk, and the landing received a false new violation or missed a real one. A config missing among the installed does not crash the inspection on `platforms`: every file resolved through it becomes unresolved with the same way out.
