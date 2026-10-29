---
id: 01a0cfab-71cf-7f69-992b-9a35252bf193
title: "Build command rules as data: the store, write/remove/read operations with anchors, the write floor, and the turn section"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cfac-23b7-74b5-af8b-5e3efc50fd96",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf38-b201-7723-b919-48c38cb4e34f
---
This is stage 1, part 2 of [[8cb4e34f]].
- **Scope:**
  - the rule table and its migration, with a reach that cascades on the thread and an origin kept as text;
  - `write_command_rule`, `remove_command_rule` and `read_command_rules`, mounted by the graph capability, with anchors, the write answer (id, overrides, overridden-by), refusal of program rules until [[13e3cf43]] lands, and the ceiling;
  - the floor that asks under review and trust;
  - the turn-context section, sent at session start and on every change;
  - one pure resolver: given a thread, a tool and a requested time, it answers the limit, its origin and the deciding rule.
- **Outside this task:** the resolver is joined to admission and to the local road by the tool part, after part 1.
- **Proof:** acceptance criteria 3, 7, 8 and 9 (the resolver-level cases); typecheck clean; server suites green.