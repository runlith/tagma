---
id: 01a1b285-bd56-79e4-9bf9-190462e4abe6
title: A compiled view build is keyed by what the plugin ships, Svelte's version and the compile options, so the same views never compile twice and a Tagma update recompiles them
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1b1a5-f0a8-701e-8971-9bf996ba6027
sources:
  - kind: file
    ref: apps/tagma/server/src/views/modules/builds.ts
  - kind: file
    ref: apps/tagma/server/src/views/modules/compile.worker.ts
  - kind: file
    ref: apps/tagma/server/src/views/modules/routes.ts
---
The key hashes the digest of what the plugin ships under `dist/ui/` (`graph.json` and every file it names) together with Svelte's version and the window's compile options (`compileSignature`). A build depends on nothing else, so the key is its identity. A re-enable, a second publication of the same views or a server start finds `index.json` under the key and compiles nothing: the worker never starts. An update of Tagma that changes Svelte or the compile options changes the key and recompiles, with no rebuild of the plugin.

A build is staged in a `.partial` directory and renamed whole onto its key, with `index.json` written last. An index standing at a key therefore means a whole build, and two servers or two asks racing on one key leave one of them. Every address carries its key, so the routes serve modules as immutable, and a window never mixes two builds of one plugin. A new key is a new address, from which an open view remounts. After a ready build the plugin's other keys are swept except the newest, which a window still mounting from the previous address can reach; a leftover `.partial` always goes.

The compile runs in one worker off the server's thread. It answers asks in order and closes after five idle minutes, so a machine whose plugins changed nothing holds no compiler. A refused compile settles the plugin's views as `failed` with the file and puts a fault on the plugin's `views` point, which its `read_plugins` row and card show. Its process and tools are untouched.
