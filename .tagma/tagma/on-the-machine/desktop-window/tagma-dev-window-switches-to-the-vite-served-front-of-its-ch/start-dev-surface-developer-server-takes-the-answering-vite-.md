---
id: 01a17d3f-71d4-76b0-9351-4fe8e0e89594
title: "start_dev_surface: developer server takes the answering Vite or starts its checkout's Vite in a held terminal"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17d2e-dc08-72c3-b559-91ce24b075ba",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17d3f-1d04-7f62-bd64-5be6b724c701
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-builds
---
The server part of [[b724c701]]: an operation of the checkout-builds module, absent from the release composition. Desktop main calls it (`POST /api/op/start_dev_surface`, body `{}`, no project), as it now calls `restart_server`.
