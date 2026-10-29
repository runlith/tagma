---
id: 01a12c8e-e9ff-7e7e-8a6c-298687fba72c
title: edit with an empty oldString creates the file's missing parents
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4efd9c8236",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12c87-3dba-7604-92dd-70820db0e31b
sources:
  - kind: file
    ref: packages/agent-tools/src/edit.ts
---
When creating a file through edit with an empty oldString the physical address is already resolved, but execute does not create parent directories before CAS, unlike write. Confirm through the public edit, fix the creation branch at the owner, and check that admission and CAS do not change. Fixed in bfb18cc7ae: the creation branch calls recursive makeDirectory after admission and before CAS. The public edit test came out red/green; all 15 preparedSubjects integration tests and the agent-tools typecheck passed. The trial tagma:try 760e57e097-dirty 20261011T200306502Z built and started on its own root and port; the file entry was checked through the public apply_batch. The operator's server is untouched.
