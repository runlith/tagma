---
id: 01a18755-c662-7691-b553-9e3302f81379
title: A main → branch graph merge re-raises the same resolved conflict after every new main graph commit, because the format-adapter commit keeps the merge base old
ord: 249
tags: ["reflection"]
fields:
  {
    "actual": "Each new main graph commit (two reflections) produced a new recovery conflicting on the same spec file (sources re-sorted with packages/scroll-follow back); merge-base stayed 3a4299cd because each incoming side is a fresh 'graph brought to the format of feed-e2e' commit outside main's history",
    "command": "automatic graph merge main → feed-e2e after resolve_graph_conflict(branch: feed-e2e) had published 12ff2c6d",
    "expected": "Once a conflict is resolved and published, the next main → branch merge has the resolution as its base and merges main's new commits cleanly"
  }
---
Filed from project `tagma`.

Recoveries 2089d1c5 and 15829c9d, both on tagma/conversation/chat/the-feed-scrolls-like-a-native-list-on-every-device-one-owne/index.md, theirs 14e944c8 and 71849478, both format commits parented on main's tip, never on the previously merged format commit. The repeats stopped only once main's graph took feed-e2e's (19081701).