---
id: 01a14be8-512a-7bf7-8826-2c1cc61fe87b
title: "Give agents \"Ready answers\": buttons with the operator's likely replies under a remark"
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14be0-6dbd-7c44-919a-16414bb7c333
---
The `offer_ready_answers` tool, feed recording, and chat buttons are built, but the server gives the tool to no agent ([[4bb7c333]]). Enabling means adding the `threadReadyAnswerTools` set to the native agent.

The benefit: the operator answers "yes"/"go" with one press. The cost: one more tool schema in every thread's prompt. Decide: enable for everyone, only some agents, or as a deferred tool. Before enabling, open the buttons in the current app: their look was never checked.

The operator decided to postpone: for now the feature gives him no benefit.
