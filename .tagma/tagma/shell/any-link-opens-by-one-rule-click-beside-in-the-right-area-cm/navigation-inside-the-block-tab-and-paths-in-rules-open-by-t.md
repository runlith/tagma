---
id: 01a17460-41fe-76f5-8c5c-4c75c156b2fe
title: Navigation inside the block tab and paths in Rules open by the link rule
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17426-d184-7e34-95ad-c9ef91872aaf",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1741f-a3b7-7fc0-bf9a-6e37d7bc5513
---
Acceptance of [[d7bc5513]] demands no other "where to open" paths. After 1a996091a9 two places past `Opening` remain: breadcrumbs and outline rows inside the block tab lead through the main-page address and carry the main area to Knowledge, and file paths in Rules (`features/rules/Engine.svelte`) open via a direct `FileOpener.open`. Inside the block tab, clicking another block opens it beside (as a tab), Cmd-click — in Knowledge. The "+ → File…" palette is an explicit command, not a link, and stays as is.
