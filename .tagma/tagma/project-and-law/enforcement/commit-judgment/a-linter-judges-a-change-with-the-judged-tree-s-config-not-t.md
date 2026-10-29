---
id: 01a16909-a80c-7587-b543-37a794b0d833
title: A linter judges a change with the judged tree's config, not the working tree's file
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/ast-grep.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/eslint.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/filesRunner.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/oxlint.ts
---
Config from the `Linters.*({ config })` description is read as a blob of the judged tree, like the project program ([[261204b5]]). Otherwise a teammate's uncommitted edit to the config would judge other people's landings, and both sides of a change wouldn't be judged by one description from the commit version.

Ruff, Semgrep and ast-grep read the file handed to them in `--config` themselves. So the server puts the tree's config copy into a temporary directory at the same relative path, with ast-grep's YAML rules from that tree's `ruleDirs` alongside it. The temporary directory lives until the judgment ends. oxlint receives a server-assembled config whose text comes from the tree. Its `jsPlugins` still resolve from the config's place in the checkout, and oxlint loads plugin files from disk. The ESLint JS config is imported by the driver. Bun starts the driver with the same preload as the program runner ([[261204b5]]), and the preload swaps files that differ from the tree.

If the config isn't in the judged tree (it's git-ignored or unadded), all five linters fail the judgment with `inspection-failed`: an inspection by which the gate judges a shared commit can't depend on one machine's private file.
