---
id: 01a14c18-c833-7d88-b3bd-66eb312abbba
title: Finish migrating composition/testing/threads to scoped Effect
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae6-7c7d-9cc2-edc404b6eb7f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/threads
---
Migrate the remaining tests and own fixtures in apps/tagma/server/src/composition/testing/threads to effect4 and @runlith/effect-test; keep the real birth, journal, list, lifecycle and protocol contracts. The touched files' checks and typecheck pass, the style-checker finds no remainder, scopes release, the independent Sol review is worked through, the result landed. The shared composition fixtures belong to a separate task; a contract change to them is coordinated before touching consumers.
