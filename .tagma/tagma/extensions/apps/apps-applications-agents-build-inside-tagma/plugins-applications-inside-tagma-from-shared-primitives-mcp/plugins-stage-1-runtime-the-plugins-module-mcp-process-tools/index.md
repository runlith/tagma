---
id: 01a12306-efba-7a0e-94d7-05eba00aaf5b
title: "Plugins, stage 1: runtime — the plugins module, MCP process, tools/agents/on, text poker"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
Stage 1 of spec [[a0a16218]]. Child tasks split it into deliverable parts; the stage closes when text poker passes the spec's acceptance with changes to its own package only.

Order: [[c0602266]], [[ec9d1962]], and [[d6340847]] in parallel → [[511bce7b]] → [[5ced9ad0]].

Acceptance [[5ced9ad0]] passed with the plugin package (commits f9d7a155d5, 22e93130d1): a table of 9 players on Muse completed 50 hands with no stalls and no 429s, all three properties confirmed live; CPU, loop-lag, and memory numbers are in [[5ced9ad0]]'s body.
