---
id: 01a12c9a-1443-7956-b2a6-ce71985d3804
title: set_module renaming a module id retires its debt as vanished and records the same violations as escaped under the new id
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "Rule 083d37f1 re-measured `debt 5 → 2`: three unresolved entries for the previous desktop module id retired, and the identical violations under `@tagma/desktop` recorded as escaped, so landing that file would refuse at gate. Restoring them took a second act: enforce_rule with `absorb` and the owner task (4fe9507f) looked up by hand.",
    "command": "set_module on 2f69b0c4 changing the desktop module id to `@tagma/desktop` (pure rename; npm package already renamed), project runlith",
    "expected": "The id is the key debt is filed under; a rename of the id re-keys the module's debt entries with their owners, and the re-measure reports debt unchanged"
  }
---
Filed from project `runlith`.

No violation changed — only the module's key. Any id rename of a module with debt repeats this, and the caller must know to find the old owner and re-absorb. set_module already measures every enforced rule the change moves, so it is the place that can carry the entries across.