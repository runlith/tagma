---
id: 01a17f29-c3b7-76cd-9383-4bf565eec4a8
title: "\"Drop compatibility with issued 0.1.x: flat feed and cut-record fields, the app-place record, window copy restore, the frozen tagma:transition window\""
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17f1d-0712-7796-8a03-a68232e94329",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17f29-c340-781d-b849-69493bb9e31f
---
Delete everything kept only for 0.1.x: `LEGACY_PLATFORM` and `archivesOf`, flat feed-record and `release.json` fields, `image` parsing, the trial-launch branch for a server without `readFrom`, `clearPlace` and `install/application`, the window's `keepCopy`, the frozen window and the `tagma:transition` "button" world. The trial transition targets the build machine.
