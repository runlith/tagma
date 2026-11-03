---
id: 01a1a257-33c8-716c-a949-a334cc97ca87
title: Stream installation proof away from the serving loop
ord: 64
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a18-7360-ba89-67591ec4329c",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
---
Installation verification now sends bounded filesystem-stream chunks to a process-lifetime proof worker for incremental hashing; manifest decoding and identity computation run there too. The verifyInstallation regression failed on a memory filesystem that refused whole-file part reads, then passed with a multi-chunk runtime and typed surface-digest mismatch; proof.test.ts passed seeds 1, 2 and 3.