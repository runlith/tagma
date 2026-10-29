---
id: 01a1805f-e85d-7e67-8f69-9fcdcde5c183
title: "The graph remote and project storage moves know the stealth layer: set_graph_remote accepts a team project, set_project_storage keeps the named subtrees stealth"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18045-d0e1-7f6a-b44e-0cf66973f046",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1805a-1f26-7e78-975f-db2cccba6116
  - kind: waits-on
    to: 01a1805f-e85d-7e67-8f69-9fca40a22264
---
A team project gets a graph remote for its stealth tree, registration with --graph-remote raises the layer; a stealth → team move keeps the named subtrees in the stealth tree, team → stealth merges .tagma into it.
