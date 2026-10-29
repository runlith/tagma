---
id: 01a1705d-83e8-7764-b21d-e93e56127c92
title: "Dragging a subagent: onto the parent — pin, onto \"N finished\" — unpin"
ord: 2
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
Second step of [[486c7d1b|the spec]]: a drag started on a subagent row carries it alone; targets are its parent's row with the team's visible part (pin) and that parent's "N finished" fold (unpin). Dragging a root — into a folder, Pinned, archive — does not change.
