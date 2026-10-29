---
id: 01a13aef-2f3e-7311-b286-1befd0504a54
title: continue_agent on a child a message just woke answers a storage failure instead of refusing a running child
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "Error \"Thread storage failed in transition: … the thread kept moving until the deadline, so nothing was written\" — reads as a storage fault, not as the documented refusal.",
    "command": "send_message {to: \"inv-infra\"} (answered status woken, new runId), then continue_agent {threadId: \"inv-infra\"}",
    "expected": "A typed refusal naming that the child is already running (the contract says it refuses a running child)."
  }
---
Filed from project `runlith`.