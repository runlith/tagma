---
id: 01a1652f-84e7-7116-9026-de53d0839f81
title: Split hosted models and terminal OpenCode/Cursor CLIs in thread creation
ord: 112
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1652d-02f2-72c3-b32a-d3db9662b6b0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16434-fc60-7079-91d8-189b5bb2bceb
  - kind: implements
    to: 01a16472-6102-7eea-b3b2-337e6b694470
---
Hosted OpenCode and Cursor are picked as regular chat models; "CLI agents" offers only terminal CLIs with a terminal mark and icon. Add a terminal bundled OpenCode V2 with supported integration, keep hosted independent of a terminal binary install, and check both paths on a personal tagma:try without touching the operator's working server.
