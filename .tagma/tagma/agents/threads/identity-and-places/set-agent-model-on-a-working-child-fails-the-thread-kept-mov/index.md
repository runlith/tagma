---
id: 01a1362c-2770-7c98-addb-ad9c308ce118
title: set_agent_model on a working child fails 'the thread kept moving until the deadline, so nothing was written'
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "Error 'Thread storage failed in transition: Thread 01a13620…: the thread kept moving until the deadline, so nothing was written.' The model did not change. The answer has neither unblock nor a sign the call may be retried.",
    "command": "set_agent_model({threadId: \"worktree-delete\", model: \"claude-opus-5-5\", reasoning: \"high\"}) — child 01a13620-38ed-786c-8629-dfdc6e7a44e0 working (gpt-6.1-sol xhigh)",
    "expected": "Per the operation's contract, a working child finishes the current step and continues the same work on the new model"
  }
---
Filed from project `runlith`.
