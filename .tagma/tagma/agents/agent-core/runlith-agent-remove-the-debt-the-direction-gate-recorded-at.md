---
id: 01a0eed5-addc-74fb-ba1d-8b2f9bc60272
title: "@runlith/agent: remove the debt the `direction` gate recorded at enforcement"
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ef6c-0363-7893-8b44-a6c6130bf309",
    "status": "done"
  }
---
The gates enforced on 2026-09-29 recorded 11 under [[94d54cd1]] (`direction`) as debt owned by this task: each is a standing violation in `@runlith/agent` that the gate now refuses anywhere else. Remove each at its owner — a crossing by a declared port, an entry or a relation the module's card accepts through `enforce_rule`, or a move; a swallowed failure by handling its condition, mapping it to the typed refusal, or declaring best-effort with its reason as an exact allowance. The rules' debt lists (read_inspections) name every entry; an entry retires on its own once the re-measure no longer finds it.

Done when none of these entries stands in the rules' debt.
