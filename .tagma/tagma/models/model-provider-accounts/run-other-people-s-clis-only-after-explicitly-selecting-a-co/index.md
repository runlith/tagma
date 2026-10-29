---
id: 01a164c3-2ea7-722d-bc71-7e87f7258089
title: Run other people's CLIs only after explicitly selecting a connection, directory or model
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16468-4b19-7086-8df2-6a8662550643",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16472-6102-7eea-b3b2-337e6b694470
  - kind: relates
    to: 01a1361f-cf4d-7f3a-a38e-90833b360b13
  - kind: relates
    to: 01a1645e-1265-7c5e-a30d-47d238ce4f43
---
Take foreign CLIs out of providers startup/daily/catalog/quota/account-list and out of CLI discovery/integration. The basis is the user's existing addressed actions and the connection record; an old automatically found default-login proves no selection. Keep discovery on explicit request, and check the allow/refuse with a public operation running a real test process. Do not check entry 1.19→2.1.3; one Sol review and a personal landing.
