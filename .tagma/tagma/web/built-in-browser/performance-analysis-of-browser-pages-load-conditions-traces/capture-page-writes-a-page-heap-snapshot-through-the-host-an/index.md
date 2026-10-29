---
id: 01a184dc-4fbe-7b01-a2d5-4fafc9b1db59
title: capture_page writes a page heap snapshot through the host and summarizes it by class
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4faa4b4a0d78
---
**Outcome.** `capture_page` takes `what: heap`, preserving its existing capture selector. The answer names the `.heapsnapshot` file (the format Chrome DevTools opens), its size and the duration of the capture's paused strain hold (an upper bound on the renderer pause), and summarizes it: total heap size and object count, the classes with the largest self size and their counts (with `limit`), the number of native nodes marked detached by V8, and each displayed class's count and size change against the page's previous heap capture. A separate list names the largest positive class growth. Take, repeat the suspected action, take again — the growth lines name what grows. Both hosts capture the main frame's V8 isolate: same-isolate pages can appear, and other-process frames are outside it.

**How.**
- Writing the snapshot is a `PageHost` action with one contract — write this page's heap snapshot to this path — because on desktop the CDP route sends every chunk through Electron main, which drives window input, while Electron has a native route that does not. Desktop main calls `webContents.takeHeapSnapshot(path)`: the renderer writes the file itself. The managed host runs `HeapProfiler.takeHeapSnapshot` and appends each `addHeapSnapshotChunk` to the file through the CDP payload worker, never parsing chunks on the server loop.
- For the length of the capture the engine holds strain as paused, and each host owns the pause of its actual producer. An admitted snapshot is not cancellable: caller interruption and chunk-writer failure wait for the producer to settle before releasing its hold or file. There is no capture deadline; renderer crash or host loss ends the wait. Desktop heap pause stays on the captured OS renderer process; a concurrent CPU hold uses profile scope only during navigation toward an unknown speculative renderer, returning to exact membership on commit or failure. Managed watchdogs and the engine's OOP-frame probes use the profile, the narrowest known set containing that renderer. While a managed profile is paused, a genuinely hung other page of that profile is detected only after the pause ends; the same conservative delay applies to engine frame probes whose renderer identity is unknown.
- The summary is computed by a heap snapshot reader in `@runlith/performance` — the owner of the V8 heap snapshot format the server's own `capture_heap_snapshot` writes — running in a worker: one streaming pass over nodes, keyed by class name, with no dominator tree. The engine keeps the previous capture's class table beside its file for the growth comparison.
- The file holds every string in the page's heap, sign-in tokens included. It stays on the machine where the engine keeps the page's captures, newest four per page; no string from it enters the answer except class names.

**Owners.** `browser` engine and the `capture_page` operation; `PageHost` and both adapters; `@runlith/performance` for the reader.

**Acceptance.**
- A test page that creates 10,000 instances of a named class shows that class with count 10,000 in the summary; after the page creates 5,000 more, the next capture's growth line names the class at +5,000.
- A capture of a page holding at least 200 MB of heap completes without `page-unresponsive`, and the managed host keeps the target.
- On desktop the snapshot bytes never travel the CDP channel: the capture works with the engine session attached and the file opens in the reader. Electron 44.8.0 source and docs establish a native Mojo/file-handle route installed in sandboxed renderers and independent of the debugger; success with Tagma's attached session remains unproved by a desktop run, which is outside this implementation's authorized checks.
- A fifth capture of one page removes the oldest file, and the answer says so.
