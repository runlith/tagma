---
id: 01a168dd-26ca-737b-8947-b0f5261204b5
title: "A program judges a change with the judged tree's code: the runner reads tracked git sources from the tree, the rest from the checkout"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/loading.ts
---
The program runner and the ESLint driver start with one `--preload` (`treePreload.ts`), to which the server passes the root and the judged tree through the environment. Before importing the program, the preload finds with one `git diff <tree>` the JS, TS and JSON files present in both the judged tree (`tree` of the call) and the checkout but differing in content. Only on those paths does it hang a synchronous Bun runtime-plugin `onLoad` serving the tree blob. Bun loads the rest from disk itself, where bytes already match the tree: unchanged sources, everything untracked (generated, built, unadded to git) and `node_modules`. So CommonJS, `require()` of installed packages and module chains work as without a runner. A workspace package linked by a `node_modules` symlink Bun loads by its real path inside the checkout, so its changed files also come from the tree. The Bun plugin always hands the ES-module loader a source, so it executes a changed CommonJS file itself and passes its `module.exports`; a module that `require`s such a file mid-cycle doesn't see its half-filled exports. Synchronicity is needed because `require()` whose `onLoad` is still waiting is rejected by Bun. That's how a neighbour's unfinished edit in program code or its dependencies doesn't judge someone else's landing, while a session's own edit judges its own program. Both sides of a change are judged by the tree's program, as is the description from the same version's `tagma.config.ts`.

A snapshot of the judged tree into a separate directory was rejected for two reasons. With such a snapshot the program loses the untracked sitting next to its files: for `@runlith/sqlite-process` that's the SQLite library built next to `engine.ts`. And the closure over workspace `node_modules` links for a runlith program spans over 30 packages and changes with almost every commit.

Boundary: imports resolve by checkout files and `package.json`, because the runtime `onResolve` of Bun doesn't see imports from loaded files. When the judged tree holds a file missing in the checkout (a neighbour deleted or renamed it uncommitted), the import isn't found and the inspection fails. Files of other types (text import, wasm) also read from disk.
