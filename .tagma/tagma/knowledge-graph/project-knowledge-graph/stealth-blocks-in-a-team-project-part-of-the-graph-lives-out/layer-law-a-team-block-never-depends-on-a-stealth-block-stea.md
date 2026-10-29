---
id: 01a1805f-e85d-7e67-8f69-9fccfe5c3fd1
title: "Layer law: a team block never depends on a stealth block, stealth-to-team supersedes and a stealth #module refuse"
ord: 3
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
One gate in the graph write layer judges every write: a team block's parent, edges, reference fields, body links, and tags never lead into the stealth layer (stealth-dependency), a stealth block never replaces a team block (stealth-supersede), a module card is never stealth (stealth-module).
