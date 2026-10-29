---
id: 01a12c9f-f8ac-7c53-bec7-208e899e6cc7
title: "An object outliving the effect that built it holds no `$derived`: its conclusions are getters over `$state`"
ord: 40
tags: ["rule"]
edges:
  - kind: discovered-from
    to: 01a12c96-3722-7ec9-bb57-9da9a800e9c4
sources:
  - kind: dir
    ref: packages/chat-ui
---
An object that outlives the effect that built it holds no `$derived`: its conclusions are getters over `$state`.

ChatFold moves through DetachedSessions into the next session; a destroyed effect's derived keeps its last value forever (derived_inert).
