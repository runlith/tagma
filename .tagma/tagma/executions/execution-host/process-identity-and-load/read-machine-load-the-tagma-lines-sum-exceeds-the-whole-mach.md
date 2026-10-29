---
id: 01a16b0c-0491-70b5-b40c-aeb0d87d020b
title: "read_machine_load: the Tagma lines sum exceeds the whole machine load"
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The answer: machine 61.1% busy, Tagma 119.1%, agents 105.7%; the acp-words line 79.9% with two visible processes at 0.0% CPU.",
    "command": "read_machine_load({\"limit\":3})",
    "expected": "The lines' shares sum into machine CPU; Tagma and agents exceed neither 100% nor machine busy."
  }
---
Filed from project `runlith`.

The call ran during the app's baseline unit; read_machine_load handed reaped-children data. Top lines: acp-words 79.9%, installation 13.4%, pool 11.4%. CPU metrics cannot serve as a consistent decomposition of the current machine load.
