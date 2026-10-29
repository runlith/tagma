---
id: 01a12726-9e16-7f6a-a8a2-153230815684
title: "Law of place: full project orientation before the first act in it, regional law by paths of any project, per-place instructions snapshot"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12726-f0ea-7f35-b027-6fc8dbf8533f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
  - kind: relates
    to: 01a12726-9e16-7f6a-a8a2-152f37d7c9ad
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/working.ts
---
The "Law of place" section of the spec.

Do:
- A path named by a tool resolves into its own project's checkout (`CheckoutPaths.placeAcross`), and the brief is assembled from that place's graph rules and notes (`graph/orientation/touches.ts`: `placed` currently drops `source-outside`). Regional law by paths arrives after the tool as today (`touchRule`), but in the path's place; a path outside all projects gets no brief.
- The thread durably keeps the list of places outside its home where it has worked (project and graph copy) — durable across restart and compaction. The thread's first act in a non-home project records the place; a non-mutating act executes, and the place's full orientation (catalogs, tag declarations, all project rules, global rules under the place's settings — `Orientation.instructions`) arrives in the same step as its response; the first mutating act in such a project does not execute and refuses `law-unread`, the orientation arrives before the next step, and the retry executes. The home is not gated. The global project is not a place — no gate and no separate set: its rules ride inside each project's set under the home's settings. `file_reflection`, which itself routes an observation to the Tagma sources project, makes no place; the sources project becomes a place only by explicit address (`project`, a path, or a block in it).
- The instructions snapshot (`native-harness/turns/instructions.ts`, `graph/orientation/Instructions.ts`) is kept per place: set B does not remove set A, updates and withdrawals arrive per place, and after compaction the sets of all the thread's places arrive again.

Done: integration test — the first file read in B brings rule B and orientation B to the response; the first mutating act in B refuses `law-unread`, the retry executes; after a law change in B and after compaction, set B is current and A is not removed; a path outside projects gets no brief.
