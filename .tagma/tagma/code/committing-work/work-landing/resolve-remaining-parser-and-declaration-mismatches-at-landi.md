---
id: 01a1941f-f2bb-77f3-9717-654c6c7bd0aa
title: Resolve remaining parser and declaration mismatches at landing
ord: 170
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd94-70a8-8803-d52a38bf16bc",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a18679-d5f7-7d63-a817-4658b089d651
  - kind: relates
    to: 01a18745-8035-7554-91b6-fa5bb14d1306
  - kind: relates
    to: 01a190e5-ae6b-761d-9a49-aac323bfdacb
  - kind: relates
    to: 01a193e9-34c4-7d24-9748-f262c61ffd40
  - kind: relates
    to: 01a19409-a00d-7d3e-a0e8-5bbc91b82447
---
Investigate the compiler Format export refusal, valid-TypeScript parse refusal, missing-extends sample and conservative member-name refusals. Preserve the existing whole-importer dependency contract while fixing any wrong resolution at its semantic owner. Reproduce through check_rules or submit_work as reported; do not equate a permissive workaround with a root fix. Reuse the prior open-merge investigation before repeating it.