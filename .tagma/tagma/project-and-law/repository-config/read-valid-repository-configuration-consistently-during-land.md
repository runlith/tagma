---
id: 01a1941f-f2bb-77f3-9717-654f734e99df
title: Read valid repository configuration consistently during landing
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a129b7-c935-7286-8792-25ff56e7305b
  - kind: relates
    to: 01a13609-6c2c-72c0-b9dd-139b0e651b57
---
Investigate transient empty-config and missing-programs refusals against an unchanged valid configuration. Trace the versioned git input and config-evaluation boundaries, reproduce a current race or wrong-place read, and correct its producer without weakening inspections, commit steps or configuration policy. State explicitly when an obsolete error or missing historical input prevents reproduction.