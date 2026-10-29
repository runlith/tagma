---
id: 01a0cf4b-e130-7f94-a387-d312872f9ac4
title: Should a view learn an execution's grid from the host rather than from a sibling view on its page?
ord: 6
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
---
A view follows the grid another view published on the same page ([[22097468]]). A view in another window has no such neighbour. It keeps its own size, so a full-screen program it draws is laid out at a width the pty does not have until the operator focuses it there.

The host already knows the grid: its screen feed carries the geometry with every update. The open question is whether a pane should subscribe to that for its execution, or whether the byte record should carry resizes as marks the replay and the live feed both apply. The first is cheap but runs a second feed per pane. The second also fixes replay, which today lays out old bytes at whatever size the engine has.

What would inform it: how often the operator really keeps one terminal open in two windows, and what the screen feed costs a pane that only needs its geometry.
