---
id: 01a150a6-b748-7a51-95aa-7334c9e0cb28
title: Tagma system prompts and tool descriptions never state which model or reasoning level to pick
ord: 82
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src
  - kind: dir
    ref: packages/agent/src
  - kind: dir
    ref: packages/agent-tools/src
---
No model names (Fable, Opus, and others), no reasoning levels (`max`, `xhigh`), and no model selection, switching or downgrade policy of Tagma's own in text Tagma gives an agent. The operator decides which model fits which work: his own model rows (`agent.models`), with the ratings he gave them, reach agents as he configured them, and the choice among them follows those ratings.