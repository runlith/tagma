---
id: 01a16ed2-e2ae-7ea7-a467-85294462f858
title: Check the warm cost of MCP, hook records and repository listing
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-2acd-79b5-971c-b55551bfdfd0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16dee-711a-7f81-adcb-ef57275907fb
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Direct and reverse shared workers pass 19/19; final body CPU cost: mcpServe 2.6/2.4 s, hookRecord 2.4/2.7 s, repository listing 1.3/1.3 s. The profile showed SQL/Effect and spawn cost; hookRecord reuses one project instead of four, four unused rule rows removed, a real Git base set instead of constant HEAD/retirement refusals. All 9 cases/42 assertions kept, seeds 1/2/3 and typecheck green separately; commit ac917521d8. Old 21.6 s MCP was load 2.2 + world/setup 12.6 + body 6.8; this cold single sample proves no body regression against the source 3.8 s. Final conditions and numbers replaced the x10/x-workspace.tsv lines.
