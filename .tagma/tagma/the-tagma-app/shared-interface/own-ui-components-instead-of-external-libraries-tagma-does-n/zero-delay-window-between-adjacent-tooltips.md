---
id: 01a13d48-9aa9-71d0-a2d8-69060387657d
title: Zero-delay window between adjacent tooltips
ord: 11
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
When moving the pointer across a row of icons, each one currently costs a 400 ms wait. With a single tooltip host, a window where the next tooltip opens immediately after the previous one closes is cheap to build.

Why not adopted: it changes familiar behaviour. The operator decides after working with a single host from [[8e55c839]].
