---
id: 01a16358-f84e-7470-8420-207cee5ea3f2
title: "Engine memory on macOS is the process tree's `phys_footprint`: RSS sees neither compressed nor evicted memory"
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/memory.ts
---
The holder decides whom to release by engine memory, and the process decides whether to warm one more worktree. On macOS under memory pressure the system compresses and evicts idle processes' pages, and RSS falls to nearly zero while the memory stays counted for the process: an idle `tsc --api` on runlith showed 7.7 MB RSS at 2 GB `phys_footprint`. RSS would never have seen the overrun exactly when it exists. So on macOS the process-tree memory is the `phys_footprint` sum (what Activity Monitor shows), and where there is no `footprint`, the RSS sum.
