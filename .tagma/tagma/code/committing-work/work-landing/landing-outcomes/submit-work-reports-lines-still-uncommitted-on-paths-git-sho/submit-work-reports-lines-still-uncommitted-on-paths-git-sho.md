---
id: 01a12a17-2eaa-730b-bb90-7b461b24c37e
title: submit_work reports lines still uncommitted on paths git shows clean after the commit
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "left named server.ts, hostChange.stest.ts, candidate.itest.ts and offer.ts; git diff --stat against HEAD shows only assembly.ts changed",
    "command": "submit_work({ paths: [offer.ts, hostChange.stest.ts, doubles.ts] }) → 45077c2cf3",
    "expected": "left names only paths where this session's lines still differ from HEAD"
  }
---
Filed from project `runlith`.