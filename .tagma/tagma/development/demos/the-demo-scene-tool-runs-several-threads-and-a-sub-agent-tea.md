---
id: 01a15193-61ed-728d-bb56-5c29b4e03967
title: The demo scene tool runs several threads and a sub-agent team; an "agent deals work to the team" scene
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/demo/app/src
---
Now `apps/tagma/app/src/lib/demo/scene` (ThreadScript, Scene.playScene) can do one thread over a recorded background. A second scene is needed: a parent agent starts several sub-agents, they work in parallel, the operator sees the team tree in the thread list, opens a child, receives reports in the parent's thread.

The operator's requirement: the tool is extended, not rewritten — several threads, parent→children links, their feeds and list rows are run by one scene model with one clock; new cast actions are added without touching the core. The recording background (`recordings/thread.json`) is the source of wire shapes; the scene does not invent fields by hand where they can be taken from the background or the wire types. The first scene, `politeGreeting`, keeps working.

Proof: a scene unit test folds every thread's feeds and the list with no gaps, the `bun run build:demo` build, the app typecheck, the demo on 5193 shows the scene (started from `runtime.ts`).
