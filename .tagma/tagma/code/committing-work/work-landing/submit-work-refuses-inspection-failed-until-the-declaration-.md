---
id: 01a18ed7-6044-7cf2-b358-5d8d71e38a4d
title: submit_work refuses inspection-failed until the declaration and coupling indexes are rebuilt by hand with check_rules over all
ord: 161
tags: ["reflection"]
fields:
  {
    "actual": "Refused twice with inspection-failed for 14 gated rules: first \"the declaration index holds no revision within 5000 changed files\", then \"coupling has no revision index\"; each cleared only after a manual check_rules over all (aabef712, then inspection coupling)",
    "command": "submit_work paths=[apps/tagma/app/src/lib/features/plugins, …] in /Users/teunlao/runlith/tagma at HEAD ca7dbb50 → f2af0661",
    "expected": "The landing judges the change against indexes the server keeps near HEAD, as check_rules over the change did a minute earlier without refusing"
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T21:38:07.893Z, from c29f406f.

check_rules over the change at ca7dbb50 passed every rule moments before. HEAD then moved under other sessions' commits, and the landing's judge found no index revision near the new HEAD. The refusal named the manual remedy, so the work landed after two extra round trips (5.3 s and 2.0 s of remeasure), but no driver kept either index near HEAD for the gate that needs it.