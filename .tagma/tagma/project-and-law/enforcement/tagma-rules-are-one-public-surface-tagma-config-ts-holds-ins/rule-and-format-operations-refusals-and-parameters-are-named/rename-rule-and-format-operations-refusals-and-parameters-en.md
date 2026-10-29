---
id: 01a156ee-85b8-7fb5-ad25-ad048f8b4683
title: "Rename rule and format operations, refusals and parameters: `enforce_rule`, `check_rules`, `set_rule_enabled`, `set_rule_delivery`, `format-*`, `withoutFormat`, `format` skill"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1573b-bf1a-76ae-8b41-8f6db1b655a2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b088ecb31b4e
  - kind: waits-on
    to: 01a156ea-c610-782c-8954-90b16bb9bbf2
---
Everything from the table [[ecb31b4e]] except `read_config` (an operation of the `config` module, [[45445f10]] and [[90e3a1c9]]): the operation catalog, bodies, doctrine, the `rules` agent, skill, `#rule` tag, app, stored-grant migration for the database, and a graph step for triggers. Starts after the landing of [[8fa6e159]]: it touches the same operation declarations.

Proof: a grant on `enforce_law` issued before the migration allows `enforce_rule` (integration); old names refuse `unknown-operation`.
