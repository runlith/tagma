---
id: 01a12840-60f9-71dc-a14f-7b0ce7a05079
title: delete removes a large file without reading its contents outside line records
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12840-2701-7b14-bcea-6562c66293ae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1283f-2e98-7303-b877-b2115eb490fb
sources:
  - kind: file
    ref: packages/agent-tools/src/delete.ts
---
Fix deletion estimation in the file tool: its own binary 24 GB APFS SQLite clone in scratch must delete without full reading or hashing. Start with packages/agent-tools/src/delete.ts and the CAS and change-record owners; keep the protection of other holders' uncommitted lines in the checkout. Prove the sparse large file's deletion through the public tool and that checkout protection holds, land the change, and answer the original reflection.
