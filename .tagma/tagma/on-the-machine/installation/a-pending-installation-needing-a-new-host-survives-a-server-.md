---
id: 01a1a258-2dd3-7c39-8852-76b1838e1571
title: A pending installation needing a new host survives a server restart
ord: 69
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a51-7739-a251-86d1ad1d1996",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a17d4e-5eb8-77f0-b5a7-c405c1c02c1c
---
The successor refusal and waiting release live only in server memory. Persist and restore that installation-owned pending state while its current baseline remains chosen, keep the pending release through pruning, and prove the new-host consent remains actionable after a restart.