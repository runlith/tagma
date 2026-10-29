---
id: 01a16b72-6d1a-772c-9897-0280cd1e8244
title: A file's cost items are bounded by its life moments and sum to the total, and children CPU is measured per child where the runtime allows
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/core/children.ts
  - kind: file
    ref: packages/testbed/src/core/ledger.ts
---
A file's line splits its CPU and wall into items by the boundaries of its life in the worker: load — from file entry (a new global's preload or the previous file's end in the same worker) to the file's first hook, i.e. the import of the file and its module graph; guard — environment preload and isolation on entry plus the guard's verdict after the last test; world — file hooks outside tests; body — tests minus what the fixture marked as tenant or world through `span`/`measure` from `@runlith/testbed/fixture`. Items sum to the file total, so the file budget and measurements read one line, never combining sources. Under `--isolate` each file gets a new global with its builtins, and their creation falls under guard. In a sequential run in one global the next file is judged in the first hook of the next: time between them is the next file's load, the verdict the previous file's guard. A file that finished no test (its setup failed) ends at its readiness moment: otherwise the boundary would be taken from the previous file's last test and the world would come out negative.

Children CPU enters the item during which they worked, and separately `children` by kind. `Bun.spawn` children give `resourceUsage` on exit, `node:child_process` children through their inner handle, live ones measured by pid; `RUSAGE_CHILDREN` does not split children by file, so its growth is taken only for what is otherwise unmeasured — `$` commands and synchronous starts without `resourceUsage` — minus children measured during the same time. A child whose CPU the runtime does not give (Node without FFI) counts as `unmeasured`, never as zero.
