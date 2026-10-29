---
id: 01a15f69-8b01-757f-b9c1-70ca9485e53f
title: A stop travels first after the socket opens, and Enter awaits only records forming its own thread's turn
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f37-f5c3-7c80-a3c8-f3e0e3244f86",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d9511b80d7
---
Two leftovers of the client part of the spec. `Live` gives a thread's stop priority: a stop made with a closed or reconnecting socket reaches the server first, before all other commands and subscriptions. Sending awaits the answer or refusal of the same thread's model, reasoning, mode, command, and delegation records made before the press; other threads' records and unrelated settings do not hold it.
