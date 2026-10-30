---
id: 01a18ea1-b078-7050-a035-3822fd6f046f
title: Retain OpenCode's restored history until its first prompt is accepted
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac9d-7548-8cab-9f3a51c4dec2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18e92-210c-7360-a62a-354692919053
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
---
A cancelled OpenCode run can end before session.prompt while the cycle already discarded its restored journal. Clear that history only when the SDK reports actual acceptance, and prove that the next accepted prompt still receives it once.