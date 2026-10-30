---
id: 01a18a52-96d7-7721-b928-4c082e269081
title: Shared SQLite test pools adopt children born after world construction
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15e6-7864-be6c-8886c813636a",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18a51-284d-7f34-b786-fc00f111a4d7
---
A keep-mode SQLite test pool may spawn its writer, readers and checkpoint process after its shared world finished building. Pass its existing ProcessPool.adopt hook to the testbed process holder so those children belong to the pool until exit, rather than being judged as a file's residue. Prove the durable registry-reopen contract on child hosting with no teardown residue; keep the file guard unchanged and preserve scoped pool cleanup.