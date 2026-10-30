---
id: 01a18a3f-9bcf-7930-ab7e-668664d69d78
title: Preserve adopted graph ancestry across repeated incoming merges
ord: 252
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-9f3c-738e-99e0-443a3c0ba168",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18755-c662-7691-b553-9e3302f81379
---
Keep the preceding format-adopted incoming commit in the next adoption's ancestry when the target has already merged it, so a resolved migration conflict does not recur after unrelated source changes. Prove two successive automatic merges through the graph pool with the original format skew and a retained target resolution.