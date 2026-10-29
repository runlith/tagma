---
id: 01a1705d-8391-7133-bdb0-d5167961c39b
title: "Subagent pin: mark on the thread, auto-pin on the operator's word, place under the parent, menu and pin"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17031-b895-7bd4-9cb1-97e46463462f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1705d-6a90-7f7b-8501-59b8486c7d1b
---
First step of [[486c7d1b|the spec]]: server (`setPinned` on the thread itself, `spoke` pins the subagent, Return under keeps the mark, meaning `pin_thread`), app (`foldTeam` and the team aggregate, Pin/Unpin in the menu, Peek and mobile actions, pin in the row, pin key on its own row), feature 7939353e.
