---
id: 01a194dc-18c7-77a3-b431-760e08e00156
title: "@tagma/app exports the ports another root fills, so it composes without `$lib` internals"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193ea-34a6-7bcc-a27e-687b109d3ef0",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a19371-d439-78c0-9c60-473fd4b30c0c
---
A root that replaces `runtime.ts` provides the window's environment services (`ExternalLinks`, `FileSaver`, `ClientBuild`, `ServiceWorkers`, `ServerOrigin`, `Offer`), names its entry with `EntryProject`, may write a first visit (`Visits`, the threads surfaces) and reads `THEME_KEY` and `hostOs`. None of these keys has an `exports` entry, so such a root imports them through the `$lib` alias of the core's own build, and a file move inside the app breaks it unseen. Export each key from its owner file; consider letting `EntryProject` name the entry place so a root writes no visit itself.