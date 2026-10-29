---
id: 01a16176-6d9e-746e-9ecb-e84dffab2993
title: Reset resolved block names when the call's graph copy changes
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16176-1374-77ee-8d6a-b45001d73e6d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16175-d657-7764-892a-baf1cbfca4dd
---
In the invocation, cap the name-resolution cache to the chosen graph copy: after selecting another served copy or graphContext, do not pass numeric ids of the source copy into execution. Keep reusing resolutions while the copy does not change.
