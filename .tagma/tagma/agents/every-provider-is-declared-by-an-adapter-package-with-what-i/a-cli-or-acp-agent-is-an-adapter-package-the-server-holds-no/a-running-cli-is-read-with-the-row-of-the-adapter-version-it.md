---
id: 01a18e45-76f1-75e0-bbf9-983d4986bfd2
title: A running CLI is read with the row of the adapter version it runs from in every reader and after a server restart
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d5f-d1a2-7ec4-8e80-38ffb97302f1",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18d5f-4464-7fa5-a9a3-ccd6ff96ef8c
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
---
The version hold (509ecdaf82, explanation [[f928125d]]) keeps a live session's version directory and lets the hook process and the server's hook-report reader use that version's row (`HarnessAdapters.at`). Two places still read the current row:

- A server started after the session's version was updated or removed holds no row of that version, so its hook reports are read with the current row, or refused when the harness is gone; after restart plus removal the CLI never reaches rest. Fix: load held versions' rows at boot from `PackageHolders.recorded`.
- Screen, watch and other readers of a running session take the current row, not the session's version.