---
id: 01a18a3f-690e-74c8-8d03-a32dd0250fe0
title: Preserve ripgrep regex diagnostics through the grep door
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15ea-7e36-afbb-130512ebf7b5",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1322f-286e-70ed-ac45-37d9cc4bc2d5
---
Keep ripgrep's regex source, caret and cause together when grep rejects an invalid pattern; the current error projection drops the source position. Prove the original bad-pattern scenario through the grep tool before and after the fix.