---
id: 01a1a311-f5a0-7419-9dcd-1fcd8be52798
title: The machine registry file is composed from contributions its owners give; installation knows no owner's table
ord: 98
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a306-7a83-756b-aaf7-cedb798d34d5",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/installation/registry
---
Finding M3 (registry half) of the installation-layer review: `installation/registry/` dumped and restored `registry.json` by reaching into the tables, restore helpers and change services of projects, settings and the graph, so a new registry table meant an edit in installation. The owners now contribute their sections at a point below them, installation composes what it receives, and the file stays readable both ways with issued releases (frozen like the other cross-release files).