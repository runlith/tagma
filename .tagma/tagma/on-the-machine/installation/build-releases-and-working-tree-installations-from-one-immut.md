---
id: 01a1a2bb-6070-765d-ad16-10beda41e0db
title: Build releases and working-tree installations from one immutable source
ord: 81
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a18-7360-ba89-67591ec4329c",
    "status": "done"
  }
---
Capture one source snapshot before building a release or working-tree installation and run every producer against it. The recorded commit and working-tree fingerprint must describe that snapshot, so a concurrent edit or commit cannot change later cut parts or make the running installation claim code it never built; committed HEAD keeps pinned submodules and the original checkout remains the development source.