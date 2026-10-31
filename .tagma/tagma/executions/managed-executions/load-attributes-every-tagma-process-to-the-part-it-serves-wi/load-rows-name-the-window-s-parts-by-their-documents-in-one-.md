---
id: 01a1924a-436f-7b40-b6c1-d60a27dfcfc2
title: Load rows name the window's parts by their documents in one sorted Tagma list, fold idle rows and read other programs on demand
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a19236-e2ce-7b34-8015-7c0e70df78a3
sources:
  - kind: dir
    ref: apps/tagma/server/src/executions/load
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/load.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadPanel.svelte
  - kind: dir
    ref: apps/tagma/app/src/lib/features/executions/load
---
Step 4 of the spec and the window-declarations contract: `executions/load` declares the port the window task fills, keys declared processes as parts and hands them to the host subscription, names rows by their documents, and builds one sorted Tagma list with idle folding, the `others` demand and the machine's name. The app paints it with OS-neutral words, and renderer rows close what they host. The port lands first, since the window task fills it.