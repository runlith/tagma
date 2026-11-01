---
id: 01a194dd-9392-777c-a4f5-c1ee5298e57c
title: "Each root's `.use()` is judged against its own manifest: presence and conditionality everywhere, tier only where the caller's tier is known"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193ea-34a6-7bcc-a27e-687b109d3ef0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a19371-d439-78c0-9c60-473fd4b30c0c
---
The static door in `packages/layer/src/door.ts` is off in Tagma: no root declares `Manifest.app`, so 1180 `.use()` calls in the app go unjudged. Turned on as written it refuses every `.use()` of a rung-tier key (71 keys: project, graph, thread, tile), although a component inside its rung's scope reads it correctly at run time — a component's type does not know where it mounts.

Split the door: every `.use()`/`.find()` is judged for presence in the manifest and for being given without a condition; the tier is judged only where the caller's tier is known (a service's `make`, `Screen.mount`, `Process.start`). Then the core root declares `Manifest.app` in a file only the core program sees — never in `lib/app/composition.ts`, which `@tagma/app/composition` exports — so another root declares its own. Fix what the check then finds. This proves at compile time that core code never takes through `.use()` a key only another build provides.