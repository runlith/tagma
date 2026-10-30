---
id: 01a18a40-844a-7d9d-8c76-11b2fcb3b857
title: Recognize home-relative search operands before interpreting command output
ord: 142
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-8236-7d99-9bb9-e8b5738cb12c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1425a-9f99-7e34-b270-543634c043b8
---
Resolve a bare home-relative filename from the shell's home before deciding whether search output carries filenames. The minified-code report still sends match content to stat when the single input is written as ~/.local/bin/claude; prove the reported spelling through the public bash door and preserve real search sites.