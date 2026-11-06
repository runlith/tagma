---
id: 01a1239c-e5d7-7438-b8ad-5095edb17154
title: The notify point binds the sender to the outcome receiver, and switching the plugin off leaves open questions standing
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/notify/layer.ts
  - kind: file
    ref: apps/tagma/server/src/notify/operations.ts
  - kind: file
    ref: apps/tagma/server/src/notify/receiving.ts
---
The notify point means readiness to take a notification outcome: with no registered receiver the send refuses before a question is recorded. Project visibility doesn't affect a machine sender. The receiver stands while the plugin is enabled in some project and its manifest reads, whether its process runs or not: delivering an outcome is a demand, and opens an idle process. A plugin that runs in no project takes the receiver off but not the operator's question; the outcome stays in durable delivery and repeats when a receiver appears again. Notify declares a registration port and holds the receivers itself, while composition binds the port to `PluginPoints` and the MCP caller.