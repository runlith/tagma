---
id: 01a15e6c-1b7c-71f8-9faf-b3e76e8a742b
title: One STORAGE_MODES and StorageMode declaration in the projects wire
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15e62-cb08-760c-894a-b29152264451",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15e61-d6ef-7bf3-b089-23b203c2c6d6
---
STORAGE_MODES and StorageMode are declared only in projects/contract/wire/project.ts; graph/contract/wire/storage.ts neither declares nor re-exports them, REGISTRATION_STORAGES is removed, and consumers import from the declaration.
