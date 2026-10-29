---
id: 01a14be8-5129-7d33-aa2b-4a9589cbd5c6
title: Let the operator set the agent tree's token budget and the spawn slot count
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b429e21dd347
---
The mechanism is built: the code refuses a spawn when the root budget is exhausted or all server slots are taken, and run accounting counts the tree's spend against the root budget. There is no door that sets it: no operation, no setting, no screen, so the refusal never triggers ([[e21dd347]]).

For the feature to work, it needs an operation or setting that sets the root budget and the slot count, and a place in the interface where the operator sees it. Then the budget refusal would become truthful: now it offers the way out "the operator raises the tree budget", which does not exist in the product. The agent instructions also warn about a "budget and slots" bound that cannot trigger.

The operator decided to defer: the feature gives them no benefit yet. Do not delete the code.
