---
id: 01a18eb5-9bb2-75bc-9318-df75f77dcf52
title: Analyze each call-check file once per registry
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "in_work"
  }
---
The caller inspection traverses files again after reach discovery, although bindings and function analyses already belong to that registry (`architecture/calls/file.ts:254–261`). Make file analysis idempotent and drain pending functions linearly; compare the programme's measured cost while preserving the existing call/frontier fixtures.