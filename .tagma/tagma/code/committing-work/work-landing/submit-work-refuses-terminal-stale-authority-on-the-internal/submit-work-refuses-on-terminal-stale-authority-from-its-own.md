---
id: 01a12a48-0f12-7f4b-ba4d-2319b280a0a1
title: submit_work refuses on terminal-stale-authority from its own git ls-tree
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "refused with terminal-stale-authority on its own `git ls-tree … tagma.jsonc`; the same call repeated unchanged landed 15f08a605f",
    "command": "submit_work {whole:true, subject:\"Name the host candidate in its own frame…\"}",
    "expected": "the commit lands; an internal git read is retried by the door itself"
  }
---
Filed from project `runlith`.