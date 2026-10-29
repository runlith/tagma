---
id: 01a126d8-769a-7997-bfeb-d0f07b1a63ca
title: "Command wait and life: the measure on command rules, backgrounding on wait expiry, killing on life expiry, words to the agent, rule and setting migration"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126d8-b45a-7625-80ec-5c219df15839",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126d8-6256-72d0-b15a-4629c0dbf580
---
Implement the [[c0dbf580]] spec in full: the `wait`/`life` measure on command rules and its resolution, default constants and ceilings, backgrounding on wait expiry through the same `handOff`, the host deadline on the life limit, `bash` parameters, words to the agent for each outcome and vocabulary unification, the app, the migration step (measures on existing rules, the `command.defaultMs` setting → a rule). The operator's two 5-minute rules are deleted after landing.

Done when criteria 1–7 of the spec are proven by tests, typecheck and the affected suites are green, and review by the models rule has passed.
