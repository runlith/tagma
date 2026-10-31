---
id: 01a1615e-2c40-7d46-a984-58134b0b2017
title: Switching checkouts of one project reconciles the delivered law by contents
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1615d-9c1c-7791-8f8d-99ec8119fe6f",
    "status": "done"
  }
---
Remove repeated delivery of the same set when switching checkouts of one project; differing sets deliver as a diff. The mutation tolerance must keep the law snapshot read before the assistant message that caused it, and refuse when the target checkout needs not-yet-delivered text.
