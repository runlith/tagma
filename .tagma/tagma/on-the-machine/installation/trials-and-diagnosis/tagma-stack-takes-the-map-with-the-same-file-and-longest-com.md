---
id: 01a13622-ae44-7f6d-920d-bc1b267509ec
title: tagma:stack takes the map with the same file and longest common tail for a stack frame
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/stack.ts
  - kind: file
    ref: packages/bundle/src/maps.ts
---
Release maps live with the operator — the published version's in `<dev data>/maps/<release>/`, the latest build's in `<dev data>/release/maps/` — as `<release-part path>.map` (`bin/server`, `bin/cli`, `executions`, `desktop`, `surface`), while a user stack frame carries its machine path: `~/.tagma/install/<dir>/…`, `~/.tagma/executions/…`, `Tagma.app/Contents/Resources/app/…` or a surface URL. Only a path tail can match, so a frame takes the map with the same file name and most shared trailing segments. Worker names repeat in `bin/cli` and `bin/server`; a tie or no such map leaves the frame as is, never guesses.

A frame's function name is never translated: the name from the map at the frame position is the called identifier, not the enclosing function. Each builder writes maps with absolute build-machine source paths (`absoluteSources`): Bun, esbuild and Vite write them relative to different directories — build cwd, map directory — and after the build that directory means nothing. `tagma:stack` prints the source relative to the checkout it runs from when under it, absolute otherwise.
