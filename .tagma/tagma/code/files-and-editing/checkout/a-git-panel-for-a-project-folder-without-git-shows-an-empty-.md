---
id: 01a160bf-ba09-7211-8ce6-934be087d770
title: "A Git panel for a project folder without git shows an empty checkout: say the folder is not under git, and drop git acts"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a160a4-f0aa-7f0b-93ed-48cb953888d3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15eac-f9e0-7af9-a3c4-70d900707e38
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/checkout
---
After 00707e38 a non-git folder checkout's line arrives with `repository: false`: not stale, empty areas. The Git panel (`apps/tagma/app/src/lib/features/checkout`) draws it as a clean checkout with empty lists and git acts. It must say the project folder is not under git, without an error and without empty change lists, and offer no git acts that do not exist without a repository.
