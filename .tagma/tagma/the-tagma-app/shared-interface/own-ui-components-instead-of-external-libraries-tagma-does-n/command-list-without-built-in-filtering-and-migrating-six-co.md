---
id: 01a14b1b-14eb-75f6-a49c-4910d4c2400d
title: Command list without built-in filtering and migrating six consumers
ord: 21
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-690144500eab
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490cfb3764ac
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490e3ea419ee
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/command
---
Build the [[44500eab|command list]] and the shared app matching function; three pickers filter in their own model.

Done when: the spec's unit tests pass, the palette passes its own tests, `shared/ui/command` has no bits, commit.
