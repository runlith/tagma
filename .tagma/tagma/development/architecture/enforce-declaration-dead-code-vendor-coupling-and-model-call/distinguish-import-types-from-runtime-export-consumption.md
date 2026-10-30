---
id: 01a18e91-ba63-786a-a0cf-f3d2651cc6cf
title: Distinguish import types from runtime export consumption
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "done"
  }
---
An import-type expression becomes a runtime wildcard in declaration facts (`checks/law/declarations/read.ts:444–447`, `dead.ts:42–44`), hiding unused functions and unrelated exports. Prove the named type-only consumption through dead-code inspection and correct the fact producer.