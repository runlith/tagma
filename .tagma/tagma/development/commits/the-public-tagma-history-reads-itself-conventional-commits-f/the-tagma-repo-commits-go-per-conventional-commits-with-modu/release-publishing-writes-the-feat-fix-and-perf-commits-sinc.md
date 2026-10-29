---
id: 01a180c0-3848-77f5-805f-e427a470f72b
title: Release publishing writes the feat, fix and perf commits since the last release into the GitHub Release body
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a180c0-b266-7237-a084-897f136fac5a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17f5f-3c8d-78c2-b6c7-2ab23bffa0a7
---
The release-notes part of [[3bffa0a7]]: `installation/cut/publish.ts` groups the Conventional Commits since the previous release by type with scope and `Task` lines, `BREAKING CHANGE` first; graph commits and other types never reach the notes.