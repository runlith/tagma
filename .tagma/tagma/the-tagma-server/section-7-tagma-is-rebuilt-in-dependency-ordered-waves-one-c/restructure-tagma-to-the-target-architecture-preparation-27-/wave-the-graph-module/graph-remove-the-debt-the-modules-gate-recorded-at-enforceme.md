---
id: 01a0eed5-add5-7aab-aff8-4aa661ca92c6
title: "graph: remove the debt the `modules` gate recorded at enforcement"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ef6b-ffd2-7578-84f0-094a77688c59",
    "status": "done"
  }
---
The gates enforced on 2026-09-29 recorded 19 under [[083d37f1]] (`modules`) as debt owned by this task: each is a standing violation in `graph` that the gate now refuses anywhere else. Remove each at its owner — a crossing by a declared port, an entry or a relation the module's card accepts through `enforce_rule`, or a move; a swallowed failure by handling its condition, mapping it to the typed refusal, or declaring best-effort with its reason as an exact allowance. The rules' debt lists (read_inspections) name every entry; an entry retires on its own once the re-measure no longer finds it.

Done when none of these entries stands in the rules' debt.
