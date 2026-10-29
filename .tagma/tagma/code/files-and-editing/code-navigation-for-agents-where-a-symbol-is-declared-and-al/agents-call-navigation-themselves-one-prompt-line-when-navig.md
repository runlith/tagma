---
id: 01a16bc8-a586-7752-ba4d-a2b0a473921d
title: "Agents call navigation themselves: one prompt line when navigation is on, the same line in the enablement notice, compressed uses and definition descriptions"
ord: 46
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16063-3d26-728c-a9fe-a15d601d54a5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
Without a prompt line in the task, Sonnet calls `uses` in about half of runs, Muse never calls it. The prompt names only `glob`/`grep` as search, and navigation has no section of its own. A thread born with navigation on gets one imperative line right after the search line. A thread born earlier gets it in the enablement notice. The `uses`/`definition` descriptions shrink so the prompt does not grow overall. A disabled capability's section does not land in the prompt.
