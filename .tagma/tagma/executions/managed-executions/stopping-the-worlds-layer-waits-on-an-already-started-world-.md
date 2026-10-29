---
id: 01a13bbe-2349-7fb3-9347-cb8eb5799882
title: "Stopping the Worlds layer waits on an already started world opening with no limit: a hung host.world hangs the server stop"
ord: 94
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13bbe-4379-764c-acff-b565d91d552a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b48-b2a2-7d3d-be03-ef7abfed53d4
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/worlds/cache.ts
---
Since 04826c083b the `worldsLayer` finalizer (`executions/worlds/cache.ts`, `makeLeasedWorlds`) closes the openings scope and waits on running `opened`, which are not interruptible; the flight ceiling (10 min) bounds only the waiters. If `host.world` hangs, the server stop hangs with it. Before the change the stop did not wait, but the opened world leaked.

Do: opening is interrupted when the layer closes, and a partially opened world is freed by its own finalizer (acquireRelease with an interruptible acquire, or equivalent), so the stop is bounded and the world never leaks. Proof is a test: closing the layer during a hung opening completes and runs the world's finalizer.
