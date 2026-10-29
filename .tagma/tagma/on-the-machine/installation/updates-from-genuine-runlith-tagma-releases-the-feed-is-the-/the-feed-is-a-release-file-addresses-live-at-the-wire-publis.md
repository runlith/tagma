---
id: 01a17f29-c3a6-75a3-a3c8-1b9f0ef76e45
title: "\"The feed is a release file: addresses live at the wire, publishing goes draft → files and feed → Latest, the build reads the published through gh\""
ord: 1
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
The Latest feed address and the release file addresses live at `installation/contract/wire/feed.ts`; the client reads `releases/latest/download/feed.json`. `publish` checks `gh` and `push` before Apple, tags the draft at the cut's commit, uploads archives, DMG and the feed (the previous Latest plus the release), publishes `--latest` and verifies the addresses; retry, pulled release and deleted number follow the spec. The build takes the Latest feed and published numbers through `gh`; the number follows the largest published one or checkout tag, the first is 0.2.0.
