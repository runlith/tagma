---
id: 01a16358-f65f-76d8-95b4-72e3fb0717af
title: A worktree with a different lockfile sees its dependencies through layer links to content-diverged records of its own node_modules, and without its own install the base dependencies and a `dependencies` problem
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/checkout.ts
---
The layer places differences by base paths, so modules without special links resolve from the base's `node_modules` — true while the worktree lockfile matches. With a different lockfile the engine compares every top-level `node_modules` record of each worktree package with the base's same record by content: the package version and, recursively, everything resolved from it — its own `node_modules` and neighbors in the package store (`.bun`, `.pnpm`). A record diverged on even a transitive version is replaced by the layer with a link to the worktree record, and records the worktree lacks are hidden; identical content under different lockfiles is not a difference. Links to the repository's own packages repeat the same relative link instead of leading to the worktree: otherwise their sources would become a second copy under worktree paths beside the same base-path files.

Dependency files substituted by a link are read by TypeScript at their true worktree paths, so the answer names them from the worktree root, and a question on such a path finds them there. A worktree with a different lockfile but no own install answers on base dependencies, and the answer edge names it as a `dependencies` problem. Such a worktree needs no separate engine.
