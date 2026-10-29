---
id: 01a13be8-c38c-7f61-871f-39a8b15fe648
title: "Move to Effect style: the composition/testing/socket tests"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13be9-049f-7acf-80f4-ecb1654eab6c",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/socket
---
A trial migration wave. Scope: `apps/tagma/server/src/composition/testing/socket/` (measurement 2026-10-14: 110 sites, almost all running effects past `@runlith/effect-test`). Shared composition/testing fixtures outside the directory change only when a test cannot be migrated without it, and so as not to break other tests. Proof is zero effect-style findings for the directory, the directory tests green.
