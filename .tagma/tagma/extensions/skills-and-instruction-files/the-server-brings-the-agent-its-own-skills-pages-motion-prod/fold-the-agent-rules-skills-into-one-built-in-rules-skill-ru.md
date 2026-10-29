---
id: 01a159bc-1038-7619-9185-95b9f7d6889f
title: "Fold the agent rules skills into one built-in `rules` skill: rule, check, enforce_rule, own inspections and linters, format commands, Rules screen"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a159ba-06a6-73f4-b4aa-a0b838a30fe2",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/native-harness/agents/rules
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/pool.ts
---
Rules have one surface — `tagma.config.ts`, the `@runlith/tagma/rules` package and `#rule` in the graph — so there is one built-in skill. The `rules` skill replaces `format` (formerly `commit-steps`) and teaches the whole rules workflow: rule or an order for now, writing `#rule` and delivery, a check from a rule via `read_inspections`, the key in the config and a trial `check_rules`, `enforce_rule` with strictnesses, triggers, debt and escapes, own inspections and linters, format commands with a baseline commit, the Rules screen. The `format` skill is removed by the same change; what is useful moves from the built-in `rules` agent prompt into the skill, and the report decides and justifies the fate of the agent.

Start at `apps/tagma/server/src/native-harness/skills/`. Proof — a landed commit, server typecheck, review per the [[6ccec00a|review rule]]. The skill is kept current per [[de8d5a75]].
