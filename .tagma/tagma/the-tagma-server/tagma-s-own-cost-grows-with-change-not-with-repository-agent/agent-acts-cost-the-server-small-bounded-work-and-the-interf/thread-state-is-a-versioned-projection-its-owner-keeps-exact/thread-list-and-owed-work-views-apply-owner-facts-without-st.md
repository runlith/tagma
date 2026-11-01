---
id: 01a1966b-9fef-7777-8c93-a5fc52e78f51
title: Thread list and owed-work views apply owner facts without storage reads
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a194e7-71c1-7fa0-8aa8-0a7696d9c507",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
---
Maintain the thread list, owed-work flags and their keep-warm, graph-copy and attention consumers from complete owner-produced narrow facts, instead of re-reading whole thread state for each phase or publication. Keep the event declarations, producers and consumers together; apply their committed revisions and transient ordering at the owning projection. Birth, removal, group membership, list windows, active/latest/outcome run semantics and idle/awaiting status retain their existing behavior. Incrementally applied changes perform no storage reads; initialization and gap recovery use an exact cut shared with the source/hydration owner. Rest/wake/form/repair source-publication mechanics remain with that owner, while list facts arise at the owning record or rest-stamp commit boundary.