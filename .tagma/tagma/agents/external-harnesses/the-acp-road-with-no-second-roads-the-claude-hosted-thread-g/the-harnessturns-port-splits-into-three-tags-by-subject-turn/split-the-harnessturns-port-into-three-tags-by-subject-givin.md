---
id: 01a11401-0fc2-7ae2-9e45-3dadbbcb972f
title: Split the HarnessTurns port into three tags by subject, giving each consumer only the ones it needs
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a115e3-27a3-74d9-bc74-6496ce645489",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a113ff-0d62-74ec-ae7c-e91522a95947
  - kind: waits-on
    to: 01a11401-0fc2-7ae2-9e45-3dab1b0cec2e
---
Do what spec [[22a95947|turn port]] describes: `threads/contract/service/harnessTurns.ts`, the implementation in `threads/harness/turns.ts`, composition and consumers in `external-harnesses`.

Done when the server typecheck and the protocol and compaction system tests pass with assertions unchanged.
