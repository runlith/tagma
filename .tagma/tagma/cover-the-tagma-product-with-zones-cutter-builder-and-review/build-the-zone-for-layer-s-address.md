---
id: 01a0c702-18a6-7b66-a04c-e648bc6c8c0d
title: Build the zone for layer's address
ord: 60
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c706-7710-76b7-afb8-4c7fe69b8077",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/Router.ts
---
Fill [[1cb76434]] with the claims its code establishes. Read `src/Router.ts` whole; the two hosts that fill it are `src/sveltekit/index.ts` and `src/sveltekit/server.ts`, owned by [[816a06c2]]. Watch: why the key holds a source rather than values, what the unchecked pathname cast is for and who is allowed to make it, and what a replaced history entry is used for. The module already states that only one entry reads SvelteKit's app modules — [[89cf9c24]]. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].