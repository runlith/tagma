---
id: 01a18a3f-8a7a-7de1-8f6c-ab9a114c1450
title: Spell out the existing whole-file comment exemption
ord: 150
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15e3-7d96-9a7d-97c40be003f0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1860d-cd09-7d59-b00e-b103b73f97b6
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/wire/writes.ts
---
Name the existing first-comment exemption syntax in the strip_comments operation description so callers can preserve verbatim fixture data without changing the comment policy. Verify the wording against the source-comments classifier and its existing marker tests; no runtime contract changes.