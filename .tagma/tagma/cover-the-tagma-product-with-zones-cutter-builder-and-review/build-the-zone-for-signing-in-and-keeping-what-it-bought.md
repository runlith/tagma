---
id: 01a0c83e-72b4-70b1-9ed0-2650bb5a61e1
title: Build the zone for signing in, and keeping what it bought
ord: 121
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c843-4c1e-70ae-9b90-7f2bbbc7e92e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/llm/src/oauth
---
Write the claims of [[1956257e]] from `packages/llm/src/oauth` — the sign-in owner, the loopback callback, the PKCE and the vendor CLI logins; its children [[d288a00a]] and [[0909b860]] own the flows and the store. Parent [[249ce587]], reference shape [[6c81c6f3]]. What a pending sign-in is, what the callback server binds and for how long, and what reading another tool's login file does and does not establish about that login still being valid.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.