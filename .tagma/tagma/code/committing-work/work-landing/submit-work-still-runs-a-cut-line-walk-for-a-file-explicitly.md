---
id: 01a18d97-fcea-7337-915d-139d6a678943
title: submit_work still runs a cut line walk for a file explicitly carried whole
ord: 160
tags: ["reflection"]
fields:
  {
    "actual": "The explicit paths-and-whole retry again refused walk-cut on protocol/process.ts after its worker exceeded the 30000 ms wall bound; the prescribed exit did not unblock the commit.",
    "command": "submit_work({paths:[...89 held paths including \"apps/tagma/server/src/external-harnesses/protocol/process.ts\"],whole:[\"apps/tagma/server/src/external-harnesses/protocol/process.ts\"],tasks:[]})",
    "expected": "Carry protocol/process.ts whole as the refusal's documented exit says, without needing the unavailable line-walk result for that file."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T12:29:55.740Z, from f9dfb4b9.