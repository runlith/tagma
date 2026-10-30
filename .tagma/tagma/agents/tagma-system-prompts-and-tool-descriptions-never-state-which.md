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
---
No model names (Fable, Opus, and others), no reasoning levels (`max`, `xhigh`), no model selection, switching, or downgrade policy in text Tagma gives an agent. Which model fits which work is decided by the operator in their own words and rules.
