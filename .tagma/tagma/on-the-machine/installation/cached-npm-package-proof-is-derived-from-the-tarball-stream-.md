---
id: 01a1a2c7-c6d2-7646-a088-a1c603e18ccf
title: Cached npm package proof is derived from the tarball stream under a versioned cache layout
ord: 90
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2bb-0459-7176-badc-24848053ea08",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1a2bc-b545-7227-886d-aacb0833591e
  - kind: relates
    to: 01a175fa-0796-7d73-bb31-52776a1d5919
---
Follow-up to the cached-package verification: a take derives the expected files, links and exec bits straight from the stored tarball through the shared installation tar reader and compares the cached tree against them — no second disk extraction. Proof entries are canonical JSON; the cache lives under a versioned `proven-1` directory so entries left by the unproven layout are ignored rather than removed.