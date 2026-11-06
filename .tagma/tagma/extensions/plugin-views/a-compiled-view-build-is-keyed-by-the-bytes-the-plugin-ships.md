---
id: 01a1b285-bd56-79e4-9bf9-190462e4abe6
title: A compiled view build is keyed by the bytes the plugin ships, its view entries and the build's own description, so the same views never compile twice and a Tagma update recompiles them
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
  - kind: file
    ref: apps/tagma/server/src/views/modules/compile.ts
  - kind: file
    ref: apps/tagma/server/src/views/contract/wire/compile.ts
---
The key hashes four things:
- the digest of what the plugin ships under `dist/ui/`: `graph.json` and every file it names, in sorted order;
- the plugin's view entries, sorted. Splitting depends on them, so adding a view whose file another view already imports gives that view a module of its own;
- the view-build description the `views` wire declares: component and module compile options, every `Bun.build` option the worker passes, and a format number for the worker's own code. The worker spreads exactly that description into its build;
- the tools: Svelte's version, Bun's version, and the source text of the SDK's bundling plugins (`graphFiles`, `svelteFiles`).

So an update of Tagma that changes Svelte, Bun, the bundling or an option recompiles every plugin's views with no rebuild of the plugin, and nothing has to be remembered to bump. A re-enable, a second publication of the same views or a server start finds `index.json` under the key and compiles nothing: the worker never starts.

**The worker compiles a snapshot, not the plugin's directory.** `dist/ui/` is live: `tagma-plugin build` deletes and rewrites it, and an update replaces the installed copy. So the worker reads each shipped file once, into `<plugin>/.source/` beside the builds, hashes the bytes it read with the hasher `plugins`' digest worker uses, and compiles only that copy. The output is stored under the key of those bytes, which the answer carries, and the server adopts it. So a build always matches its key, however the directory moved while it was read, and no lease on the installed revision is needed. A file that went away while it was read means the plugin is being built again: the server reads the listing again and asks once more. The snapshot sits at one fixed place, because compiles run one at a time, so the source maps name the same paths and a recompile of the same key gives the same file names.

**Publication.** A build is staged as `<pid>-<id>.out.partial` and renamed whole onto its key, with `index.json` written last. An index standing at a key therefore means a whole build. If the rename fails, the worker reads the destination. A valid index there means another compile of the same content landed first, so the worker answers it. Anything else is an unfinished build: the worker moves it aside to a `.gone` name and renames again. A second failure is the answer, never a success. The worker sets a fresh build's modification time to the epoch, and the server sets it to now each time the key is published, cache hits included. So modification time orders keys by publication.

**The sweep.** After each ready publication, the sweep keeps the current key and the one most recently published before it, from which a window still mounting the previous address may load a lazy chunk. It removes the rest by renaming them to `.gone` first, so no key ever stands half-deleted with its `index.json`. It also removes `.gone` leftovers and `.partial` entries of another server process. After plugin-host's first pass, the directories of plugins no longer published are removed the same way, unless a publication of that plugin has started.

**The worker.** It runs off the server's thread, answers asks in order, and closes after five idle minutes. An ask whose publication was superseded is cancelled by id, and is dropped if it has not started. The server decodes only the listing of `graph.json`: paths, `dependency` and candidates, never the imports. The worker decodes the whole graph from its snapshot. A refused compile settles the plugin's views as `failed` with the file and puts a fault on the plugin's `views` point, which its `read_plugins` row and card show. Its process and tools are untouched.

**While a publication prepares,** the feed keeps the previous ready build's address for every view that build has. So a republish that keeps the key never remounts a view, and one that moves it remounts once the new build is ready.
