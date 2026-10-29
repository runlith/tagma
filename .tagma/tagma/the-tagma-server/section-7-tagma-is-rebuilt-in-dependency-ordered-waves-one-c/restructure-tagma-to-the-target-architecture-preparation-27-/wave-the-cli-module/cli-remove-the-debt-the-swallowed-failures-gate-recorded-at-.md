---
id: 01a0eed5-adc1-7648-83eb-734ee8c7746c
title: "cli: remove the debt the `swallowed-failures` gate recorded at enforcement"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ef6c-02be-73e7-b788-c33eb09d6642",
    "status": "done"
  }
---
The gates enforced on 2026-09-29 recorded 8 under [[ea465bed]] (`swallowed-failures`) as debt owned by this task: each is a standing violation in `cli` that the gate now refuses anywhere else. Remove each at its owner — a crossing by a declared port, an entry or a relation the module's card accepts through `enforce_rule`, or a move; a swallowed failure by handling its condition, mapping it to the typed refusal, or declaring best-effort with its reason as an exact allowance. The rules' debt lists (read_inspections) name every entry; an entry retires on its own once the re-measure no longer finds it.

Done when none of these entries stands in the rules' debt.
