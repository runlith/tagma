---
id: 01a1a33e-2945-7bf1-92b8-924543730aed
title: The machine registry is dumped from one database snapshot, checked before it replaces the file, and judged held by the parts' own tables
ord: 100
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a306-7a83-756b-aaf7-cedb798d34d5",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1a311-f5a0-7419-9dcd-1fcd8be52798
sources:
  - kind: dir
    ref: apps/tagma/server/src/installation/registry
---
Review E of 906f7ce1aa: each part dumped with its own query, so a registration rolled back between the projects and the policy dump left a `projects` row without `storage`, and that file replaced a good `registry.json` though no reader takes it. Boot also decided "the store holds rows" by naming `project` and `setting` in installation. All dumps of one file now read one snapshot, the assembled sections are read back by the parts before the file is replaced, and the held check walks the tables the parts declare.