---
id: 01a14fb0-e812-719e-b319-4dc353c42645
title: Model default by subscription order, "no model" answer and sign-in card in the empty draft
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14f84-68cd-75bf-8897-4433dd8555b8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14faf-e87b-7861-a541-f7f557524b3d
---
Implements [[57524b3d]] whole: provider order (subscriptions before keys, Anthropic before OpenAI), `fallbackModel` candidates with CLI sign-in, `gpt-6.1-sol` for the ChatGPT subscription, the 'no model' arm of `read_model_defaults` and the `no-model-connected` refusal at birth, the install command at the harness adapter, the sign-in card in the draft and the shared owner of the sign-in flow. Proof — a `read_model_defaults` test over four sign-in states, typecheck, a live run on one's own `tagma:try`.
