---
id: 01a13f31-7f24-7f2d-9885-db6ac9085b60
title: Enabling clock-bypass needs a separate owners-map for 483 violations
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "owners accepts only exact fingerprints. The \"*\" wildcard was ignored: 483 escaped, debt 0. Completion needs one map generator over all escaped pages.",
    "command": "enforce_law({ blockId: \"673f881b\", owners: { \"*\": \"449dfe0d\" }, strictness: \"gate\" })",
    "expected": "One task can own all of the rule's standing debt with one parameter."
  }
---
Filed from project `runlith`.
