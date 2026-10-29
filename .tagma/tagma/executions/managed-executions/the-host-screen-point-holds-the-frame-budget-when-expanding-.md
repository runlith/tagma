---
id: 01a15cb9-b6a5-78c9-b9fe-05a642d0d68d
title: The host screen point holds the frame budget when expanding links and the window history when reading from the checkpoint file
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15cb6-19a5-77d0-a011-b2cd13fb657d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15c5c-d764-7aca-9b65-9090251c93cd
  - kind: relates
    to: 01a12998-892d-777d-9268-6ead84bfd0e6
---
Found by the [[251c93cd]] delivery review:
- `withLinks` expands link tokens into full URIs across the whole point before the `frame.bytes` check, synchronously; a long OSC 8 link over many rows yields hundreds of megabytes and holds the host event loop;
- the checkpoint-file path (`standingPoint`) gets no window history and hands over a full point that may bust the budget, and the window falls back to a modeless tail.

The bound applies where the point is produced: at link expansion and at history selection, in both paths.
