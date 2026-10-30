---
id: 01a18a52-96d7-7721-b928-4c082e269081
title: Registry reopen keeps the selected SQLite hosting pool
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3e-6e5a-7691-805c-c0b5c4ec02c9",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18a51-284d-7f34-b786-fc00f111a4d7
---
Trace why the root-registry durable replacement test opens child-hosted SQLite connections despite selecting sharedPool, fix the pool/hosting construction at its producer, and prove that the public registry reopen contract leaves no SQLite children. Preserve concurrent pool-lifetime work and do not conflate this failure with an unidentified historical teardown.