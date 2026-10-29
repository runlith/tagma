---
id: 01a16548-a1c9-716e-bfe9-9bb2d09b3aba
title: Address reading of a writer-session holder and pages of the writer list
ord: 96
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16542-73ea-7d6f-bdf5-57389a60ba41",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1653e-7764-789c-8418-5d8e01944f89
---
Fix the graph's writer reads: a numeric holder resolves by address into writer and thread, and the list returns a bounded page with a total and a cursor. Native regression reproduces the caller and peer-holder of one project: before the fix limit=1 returned two rows, after it the read returns pages and an address `read_session`. A sample writer with a UUID takes 81 text bytes and 214 nested-JSON-row bytes; the 236-row ceiling comes from the 50 KiB envelope minus a 512-byte footer. The 20-row default covers the agent's recent neighbours without reading the whole history; a known holder reads directly. The app explicitly takes 200 rows for its full registry and continues with the cursor. The final regression goes through the native tool and a real served mirror with a separate WriterRegister; it is a system test of the assembled routing, the last run took 38.71 s wall time against the file's 60 s budget. A numeric id is local to the graph copy, so both doors take a checkout and preserve the original read's place.
