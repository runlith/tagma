---
id: 01a1641a-d824-799d-94d3-3d223d0040b2
title: "One agent birth in spawn_agent: history and link — a child or an independent root; fork_thread goes away"
ord: 98
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1641b-1789-7686-a42c-06899088749f",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14b71-e6c2-7781-b0d4-36f83fbcd691
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9283445ee8a6
---
An agent cannot bear an independent root with a chosen type, model, and task: `spawn_agent` bears only a child, `fork_thread` an independent branch without type, model, or task choice, and `create_thread` is not issued to agents. It is needed for an agent that leads others' teams without owning them (the operator's secretary).

Make: `spawn_agent` — the single birth tool with two choices. History: none, all, last N turns, or up to a run — its own or any addressable thread's. Link: child (as now) or an independent root with its own team, outside the creator's tree. `fork_thread` goes away — its case is "whole history, independent link".

Decided:
- a task at an independent root's birth answers the creator like `send_task` to someone else's thread;
- delegation judges every birth, depth — children only;
- origin (who created it and with which run) stays visible;
- acts over a non-descendant — stop, continue, model, archive, rollback — still need the operator's consent; the creator's rights over roots it bore stay an open product question.
