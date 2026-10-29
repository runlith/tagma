---
id: 01a16460-2389-71e3-9086-8d06355f1940
title: Keep the hosted thread's account at landing and switch the process on a different choice
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16445-0f45-7e65-90dd-ab14b2dc0fc8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16463-cbbc-70c8-bfc1-c319724d4bad
  - kind: implements
    to: 01a16434-fc60-7079-91d8-189eb81e55d7
  - kind: waits-on
    to: 01a1648e-e31e-7fe1-8c00-cc2960c5a414
  - kind: waits-on
    to: 01a16540-0201-700a-8435-e632bd8e945e
---
Carry the chosen account through landing, operator birth, spawn/fork, and moves between roads. An explicit account switch of a hosted thread between runs frees the old process and saves the choice in one record, lifting the old launch pin, keeping the vendor session and the journal. A missing account keeps the choice; null takes the default on the next launch, and a default change does not reassign an already launched process.
