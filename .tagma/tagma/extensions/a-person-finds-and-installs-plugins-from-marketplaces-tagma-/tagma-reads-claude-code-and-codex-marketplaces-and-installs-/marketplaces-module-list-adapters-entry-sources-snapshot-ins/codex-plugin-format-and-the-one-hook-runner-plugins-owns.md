---
id: 01a1898c-f260-770a-866a-c9d0f486408b
title: Codex plugin format and the one hook runner plugins owns
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18975-644d-7413-ab91-26fc38643816
---
A third plugin format adapter reads a legacy `.codex-plugin/plugin.json` directory and a root Agent Plugins manifest with OpenAI's overlay, by OpenAI's precedence; command hooks of every format run through one runner in `plugins`. Part of [[a80316d3]].