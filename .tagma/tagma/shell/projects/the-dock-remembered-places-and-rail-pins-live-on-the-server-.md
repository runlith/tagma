---
id: 01a1a688-b53e-7c02-adc5-2f5d917e62cd
title: The dock, remembered places and rail pins live on the server and look the same in every window and on every device
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a688-f524-7438-9cc5-f776300137bf",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a43cf80c5f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Strip.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Visits.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/RailPins.svelte.ts
---
The dock's set and order, the remembered place in each project and the rail's pinned places are the operator's own arrangement, yet they live in the window's `localStorage` (`tagma.strip`, `tagma.visits`, `tagma.rail`). `localStorage` is split by origin, so a window on another host or port — the dev front beside the built one, a browser on `127.0.0.1` or a LAN address, another device — shows another dock, a reset profile loses it silently, and project ids stored there live apart from the registry that issues them. The operator decided: the arrangement looks the same wherever he opens Tagma.

**Outcome.** The server keeps the app's operator documents in its database and pushes every change live; `ProjectStrip`, `Visits` and `RailPins` read and write them there instead of `localStorage`. What belongs to one window stays in memory (`ProjectStrip.here`).

**Server.** A module of its own owns opaque app documents keyed by name: a table (key, JSON value, revision), an operator-only HTTP read of all documents, a write that sets or removes one and answers its revision, and a feed publishing each change with its revision and the writing window's id. The server does not interpret a document.

**App.** A port with the `PlatformStorage` shape plus readiness, filled in the composition over `Door` and `Live`:
- it loads all documents when the window opens; until then reads answer nothing and a write is a defect, so effects that write on arrival (`ProjectStrip.enter`, the callers of `Visits.remember`) wait for readiness;
- a write updates the window's copy at once and reaches the server in order per key; its own echo is ignored, and another writer's change older than what this window already knows for that key never overwrites it;
- `watch` fires on another writer's change and on the load;
- a key the server lacks and this browser's `localStorage` holds moves to the server once and leaves `localStorage`, so nobody loses the arrangement they had; the move is never a write made inside a read.

**Acceptance.**
- Two windows on different origins against one server show the same dock set, order and look, the same rail pins and resume the same place in a project.
- An arrangement standing in `localStorage` before the change survives the first load.
- A server itest proves write, read and the feed event through the HTTP door; an app test proves own-echo, stale foreign change, readiness and the move from `localStorage`, with two instances mounted at once.
- Feature [[3cf80c5f]] says the set, look and recents follow the operator across windows and devices.
