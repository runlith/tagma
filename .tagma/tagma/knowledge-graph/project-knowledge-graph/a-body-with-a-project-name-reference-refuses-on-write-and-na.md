---
id: 01a17fcf-ad84-77c3-9b82-ad28b7937e87
title: A body with a `[[<project>/<name>]]` reference refuses on write and names the bare name instead of silently dropping the link
ord: 123
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17fc8-0671-75ed-a96c-0dcde5588d5c",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a15ade-6b77-7dd4-a000-cab5bcc075ed
---
The stored body holds the bare name: the project number is local to the machine, so `blockRefTargets` does not count an address as a reference. Yet write doors accept a body with `[[<project>/<name>]]` without a word. The reference never becomes a reference: the block page shows neither `refs →` nor `refs ←`. Reproduced 2026-10-28.

Every door through which an author writes a body must refuse with an exit naming the bare name, not silently normalize the text.
