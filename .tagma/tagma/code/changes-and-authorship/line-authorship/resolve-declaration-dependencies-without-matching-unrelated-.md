---
id: 01a18a3f-5e56-74de-9aa4-bf15a4c8c0d9
title: Resolve declaration dependencies without matching unrelated member names
ord: 149
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15eb-7a51-a5e5-75762f658f69",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a17bb7-cc67-7638-96be-59c39325fff3
  - kind: discovered-from
    to: 01a18513-686f-7a71-95ba-89703787b73c
  - kind: discovered-from
    to: 01a18579-b15b-796a-93d5-bd372e896857
  - kind: discovered-from
    to: 01a18619-0f3e-74ff-b563-2b8c8e3aead2
  - kind: discovered-from
    to: 01a18679-d5f7-7d63-a817-4658b089d651
  - kind: discovered-from
    to: 01a187c1-de8f-748b-a82d-531f974b383b
  - kind: discovered-from
    to: 01a18923-2cd4-71ca-abf6-1cc7ca37273b
---
Fix submit_work dependency analysis so independent local variables and array members are not mistaken for omitted peer declarations, while real imported member dependencies still refuse. Check adjacent ignored dependency files, whole-carried samples and the reported Svelte parser failure through minimal public-door regressions.