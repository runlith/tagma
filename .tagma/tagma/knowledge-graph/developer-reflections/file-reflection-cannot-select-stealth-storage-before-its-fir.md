---
id: 01a1942e-6df6-79ef-83da-0bdecfbfaabc
title: file_reflection cannot select stealth storage before its first publication
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "file_reflection offers no storage parameter and creates in its receiving module's storage; the subsequent move to stealth answered 'already committed', leaving the first version in team history.",
    "command": "file_reflection({title, command, expected, actual}), then set_block_storage({blockId, storage: 'stealth'})",
    "expected": "A caller following project storage policy can choose stealth before a reflection with private evidence is durably written or published."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T17:51:49.846Z, from 3a395b0b3.