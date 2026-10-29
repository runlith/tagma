---
id: 01a1805f-e85d-7e67-8f69-9fca40a22264
title: "A team-project graph copy holds the stealth tree beside .tagma: one mirror, storage-based projection, watching, commits and branch doubles"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18045-d0e1-7f6a-b44e-0cf66973f046",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1805a-1f26-7e78-975f-db2cccba6116
---
The spec's basis: the mirror takes in both trees (a stealth block's path in the mirror carries its prefix, a row carries the layer mark), the projection writes a block into its storage tree and names it by its own tree's neighbours, and the stealth tree has its own watcher, ledger, stamp, graph.git commits and branch doubles. A project with no stealth blocks works as it does now.
