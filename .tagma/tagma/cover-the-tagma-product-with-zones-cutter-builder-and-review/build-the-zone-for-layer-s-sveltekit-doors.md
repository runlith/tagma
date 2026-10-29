---
id: 01a0c702-1924-7bcf-8ab7-ed555bc4aa15
title: Build the zone for layer's SvelteKit doors
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c714-d9e6-725b-a241-c7b601e5adf9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/layer/src/sveltekit
---
Fill [[816a06c2]] with the claims its code establishes. Read `src/sveltekit/index.ts` and `src/sveltekit/server.ts` whole, with `src/server.test.ts`. Watch: what the address is while SvelteKit's own state still holds its placeholder, and why a navigation before the first one landed is refused rather than performed; what a re-resolution waits for; which headers the visitor's real address is read from and what each is trusted for; how the accepted languages are ordered; and which side takes the snapshot and which applies it. The module states that only this entry reads SvelteKit's app modules — [[89cf9c24]] — and where the closure check stands — [[1b7c5bcb]]. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].