---
id: 01a1898c-f260-770a-866a-c9cf924829ba
title: "Marketplaces module: list adapters, entry sources and snapshot installs"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1897e-e9a2-789e-a124-64ffebbecaa6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18975-644d-7413-ab91-26fc38643816
---
The `marketplaces` module with the Claude Code and Codex list adapters; an entry resolves into a plugin source (git with subdirectory, ref and commit, or folder, with the entry-declared manifest) that `plugins` installs as a snapshot recording the entry's identity. Part of [[a80316d3]].