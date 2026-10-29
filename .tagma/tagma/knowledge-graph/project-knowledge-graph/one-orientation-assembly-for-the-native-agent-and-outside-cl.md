---
id: 01a15b11-009b-7330-902b-54e6d7dd0500
title: One orientation assembly for the native agent and outside CLIs, with no counters, reading orders, or extra doors
ord: 224
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b11-2e21-740f-b4cb-eed9e9a374bd",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/orientation
---
Two threads assemble the orientation now. A native thread gets `orientation.render({ delivery: 'turn' })` from `graph/orientation/prime.ts`: project description, a map within `orientation.mapBudget` (6000 chars), "Open specs · ready tasks" counters, an "In work" list. An outside CLI gets a separate `graph/orientation/sessionStart.ts` assembly (`sessionStartParts`, `fitSessionStart`) through `session_start` (the SessionStart hook) and `first_prompt` (the first-message hook), see `external-harnesses/hooks/door.ts`. It has its own 2824-char map and orders to "read_block each [of 51 rules] by name before the first act" and "read_tags … read them before choosing work". `graph_overview` returns the first assembly with no map limit. This breaks [[dd380bf6]].

The operator's decision: one assembly, served by every door. Same contents as the native one: description, law, and a map within budget. The outside CLI gets the law in full text, because it has no Tagma system prompt. Counters, "graph_overview, scoped or whole" links, and any order to read something before the first act go away. `graph_overview` is deleted if it has no reader that cannot do without. The second assembly is deleted; hooks move to the shared one.
