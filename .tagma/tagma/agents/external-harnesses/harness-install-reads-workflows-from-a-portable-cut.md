---
id: 01a12c87-8d29-7233-9251-82e05a1dcdd2
title: Harness install reads workflows from a portable cut
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4f062231df",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12bb6-fdcd-7536-a80c-b20343f5529a
---
Fix the workflows-directory resolution for sources and the installed CLI build. Start from external-harnesses/installs/skill.ts and installation/closure/read.ts; proof is workflows reachable from the bundled CLI and copied by install.
