---
id: 01a12343-e01a-768f-bf26-816c4c312ffd
title: "Plugins, stage 3: notify — a new “Attention” source beside threads, push delivers it, the answer is a durable question with an outcome"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12343-f844-71b2-8671-d14c87016da1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “Contribution points by stage” section → “Notify”: a new owner of notifications that belong to no thread — a second source for the “Attention” list beside thread questions; push delivers them the same way. A notification may carry a question: the answer (including from a phone) is a durable record with an id and an outcome, push carries only the link to it. The sender is an outside caller (`plugin:<id>`) through an operation; the outcome reaches the sender through the owner port, composition fills it. Connecting the manifest `notify` point to the `plugins` module is separate.

Done when an integration test shows: an outside caller sends a notification with a question, it appears in “Attention” and in push, the operator's answer is recorded with an outcome and reaches the recipient port, a repeat answer does not change the outcome; a question-less notification is dismissed by the operator. Works on desktop and web.
