---
id: 01a18d5e-8351-75c1-a792-4407ebc0e81a
title: "The window for a group: one dock tile, one agent list across members, group folders, join and leave, and a project picker in the composer strip"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d71-137a-7882-8ab5-0fcfb56fd6eb",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18d49-eba5-7e14-8517-20f9249b762f
  - kind: waits-on
    to: 01a18d5e-82cf-7d6d-8d9a-304a7a5e6a93
  - kind: waits-on
    to: 01a18d5e-8318-73b3-8a51-f226d1fc7b7c
---
The person's half of groups, server reads included: the thread list and folders owned by the group, badge and crest counted across members, the dock tile, the header crumb naming the member, the project menu, marks by group order, opening another member's thread without changing the list, the "Group with" and "Leave group" flows, and the project picker before the place in the composer strip. Starts on the registry contract of the group registry task and on the strip of the new-thread place task.