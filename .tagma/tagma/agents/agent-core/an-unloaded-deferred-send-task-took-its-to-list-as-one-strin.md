---
id: 01a14a93-e4e4-7320-aa3e-811e651b99ee
title: An unloaded deferred send_task took its `to` list as one string address and answered not-found
ord: 144
tags: ["reflection"]
fields:
  {
    "actual": "The door received the literal string '[\"lean-agents-lead\"]' as one address and refused not-found, printing ~140 team names; the same call after loading the schema was delivered",
    "command": "send_task {to: [\"lean-agents-lead\"], task: …} before ToolSearch had loaded send_task's schema, in a Claude Agent SDK thread",
    "expected": "The list reaches the door as a list and the task is sent, or the door refuses body-shape naming `to` as a list of names"
  }
---
Filed from project `runlith`.

The refusal's own text names the address `["lean-agents-lead"]` — a JSON array serialized into a string — so the value was stringified before the door decoded it. The not-found answer misled: the name exists. A string that parses as a JSON array of names, arriving where the schema demands an array, is the producer's (harness) serialization of an unloaded tool's argument; either the harness passes it typed or the door's body-shape check refuses `to` as a string instead of resolving it as a name.