---
id: 01a14b1b-14eb-75f6-a49c-490e3ea419ee
title: Popover on the kit stack and migrating 14 consumers
ord: 19
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-68ff1bd06392
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490bb2ab8869
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/popover
---
Build the [[1bd06392|popover]] and migrate its consumers (`customAnchor` → `anchor`, `onCloseAutoFocus` → `returnFocus`, `onOpenAutoFocus` → `initialFocus`).

Done when: the spec's unit tests pass, `shared/ui/popover` has no bits, `bun check` is clean, commit.
