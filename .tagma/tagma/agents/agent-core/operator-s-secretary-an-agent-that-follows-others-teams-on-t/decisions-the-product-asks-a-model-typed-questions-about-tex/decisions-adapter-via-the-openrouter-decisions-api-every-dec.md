---
id: 01a16449-f3a3-7a52-9c4a-904ec8e29694
title: "Decisions adapter via the OpenRouter Decisions API: every decisions model of its catalog under one key"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1644a-51fd-7778-b15e-0d8bb420a8c4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16449-f3a3-7a52-9c4a-904c8105540f
  - kind: waits-on
    to: 01a16449-f3a3-7a52-9c4a-904d5f42cafb
---
One adapter instead of one per vendor: the OpenRouter Decisions API takes `state` and `questions` with `noul`, `choice`, `score`, and the `GET /api/v1/models?output_modalities=decisions` catalog names decision models; models from the catalog gain the `decision` capability. Mercury Decide is there (`inception/mercury-decide`); Jev is unconfirmed. Check the endpoint path and stability against the OpenRouter docs: a third-party README names `/api/alpha/decisions`. The current OpenAI-compatible server adapter only speaks chat, so this is a separate road. Live checks run on the operator's OpenRouter key; without a key, on recorded answers.

Where it plugs in: the contract is `@runlith/llm/decision` ([[f9b48de7]]). The chain already puts a `decision`-capable model first (the `decision-capable` road in `threads/roads.ts`) and takes it as the named decisions model, but `ThreadDecisions` (`threads/decisions.ts`) still asks the selected model through the text adapter's `ModelRequest.object`, and `resolveModelCall` resolves text models only. This task gives a decisions model its own call road and routes such a model to it.
