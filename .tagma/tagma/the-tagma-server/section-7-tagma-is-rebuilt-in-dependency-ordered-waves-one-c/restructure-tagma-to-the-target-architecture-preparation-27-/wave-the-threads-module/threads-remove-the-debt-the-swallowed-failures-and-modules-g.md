---
id: 01a0eed5-add0-73d8-9e58-925e21378e82
title: "threads: remove the debt the `swallowed-failures` and `modules` gates recorded at enforcement"
ord: 8
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
The gates enforced on 2026-09-29 recorded 2 under [[ea465bed]] (`swallowed-failures`), 1 under [[083d37f1]] (`modules`) as debt owned by this task: each is a standing violation in `threads` that the gate now refuses anywhere else. Remove each at its owner — a crossing by a declared port, an entry or a relation the module's card accepts through `enforce_rule`, or a move; a swallowed failure by handling its condition, mapping it to the typed refusal, or declaring best-effort with its reason as an exact allowance. The rules' debt lists (read_inspections) name every entry; an entry retires on its own once the re-measure no longer finds it.

Done when none of these entries stands in the rules' debt.
