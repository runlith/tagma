---
id: 01a1a2bc-b545-7227-886d-aacb0833591e
title: Cached npm package bytes are verified against the tarball before the cut uses them
ord: 82
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2bb-0459-7176-badc-24848053ea08",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a175fa-0796-7d73-bb31-52776a1d5919
---
`cut/locked.ts` trusted a cached package by its `integrity` marker alone, so editing a cached binary or `.node` kept the marker and the cut copied and ran those bytes. The cache entry keeps the integrity-checked tarball, and every take re-derives the expected tree from it and refuses a cached tree that differs (edited, missing, extra or relinked entries) instead of using or silently replacing it.