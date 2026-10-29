---
id: 01a0caab-fcad-79b7-9c4b-e07ce211b618
title: A surface answering mid-decision is covered by the stale silent page; the loader hears failures only
ord: 33
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
---
Nothing notifies the loader of a successful load: `main.ts` wires `did-fail-load` only, never `did-finish-load`. A surface that answers between the loader's last failed poll and the standing of the `silent`/`left` page — up to one patience window — gets that stale page stamped over a live surface, and the `if (this.onSurface) return` guard after the wait (`SurfaceLoader.ts:77`) cannot prevent it: it is unreachable through current callers (proven in review: the only `openSurface` callers are one-time setup, the `deciding`-guarded focus path, and the answered path that returns first).

Either a success notifier (`did-finish-load` clearing the decision) or a final `serverAnswers` re-check before standing the page closes the race. Removing the dead guard is optional either way; if it stays, its comment must say it is defense rather than a reachable arm.

Found by the zone review of [[10464bfd]] for [[a014cd4c]]; it implements no decision of its own. Done when a surface that answers mid-decision is loaded rather than covered, with a test pinning the interleaving (`SurfaceLoader.itest.ts` exists but pins other interleavings, not this one).