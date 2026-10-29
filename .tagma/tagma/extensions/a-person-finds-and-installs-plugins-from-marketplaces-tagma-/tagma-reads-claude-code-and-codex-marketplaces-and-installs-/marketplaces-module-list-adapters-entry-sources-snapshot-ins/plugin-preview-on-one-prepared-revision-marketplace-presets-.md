---
id: 01a1898c-f260-770a-866a-c9d143906bfa
title: Plugin preview on one prepared revision, marketplace presets and the marketplaces feed
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1897e-e9a2-789e-a124-64ffebbecaa6",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18975-644d-7413-ab91-26fc38643816
---
A preview prepares an entry's package once and install acts on that revision; prepared sources expire. Anthropic's and OpenAI's marketplaces are registered once as presets and fetched in the background; lists and install states are a live feed. Part of [[a80316d3]].