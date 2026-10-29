---
id: 01a12826-b6c7-7fa3-bbd1-24a78f8859d5
title: Changing one site of the swallowed-failures allowance requires enforce_rule to rewrite the whole 67 KiB inspection document
ord: 143
tags: ["reflection"]
fields:
  {
    "actual": "the inspection accepted only whole: 265 allowances, 67,612 bytes of JSON passed inline in the call arguments; read_inspections returns it in 86 KiB of output, which fits no single answer and reads through a saved file",
    "command": "enforce_rule ea465bed after an edit that changed the normalized text of one allowed call (packages/agent/src/agent/turn/plan.ts, projecting.ended: site 8d4593ef → e73e23e8)",
    "expected": "A point edit of one allowance — path, symbol, shape, new site, former cause — against the document's current revision"
  }
---
Filed from project `runlith`.

A site is a hash of the call's normalized text, so any edit inside an allowed call (here — removing a conditional spread) requires re-declaring the allowance. In a mass cleanup this repeats on every such edit, and each time the agent restores the whole document in its tokens. `set_module` has point `{ put, drop }`; `enforce_rule` has none for allowances.
