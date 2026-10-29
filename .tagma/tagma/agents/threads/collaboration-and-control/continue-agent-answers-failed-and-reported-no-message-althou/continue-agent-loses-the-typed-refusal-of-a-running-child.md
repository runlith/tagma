---
id: 01a12ae6-0584-7f08-8488-8b81eccec40c
title: continue_agent loses the typed refusal of a running child
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "AgentToolFailed with an empty message. The child thread was already running.",
    "command": "continue_agent with threadId and background:true.",
    "expected": "A typed thread-running refusal with a reason; the current run unchanged."
  }
---
Filed from project `runlith`.
