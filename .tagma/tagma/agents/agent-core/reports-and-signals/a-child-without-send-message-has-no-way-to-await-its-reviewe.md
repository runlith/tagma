---
id: 01a151e9-a9cc-7199-8857-1c552e5941b2
title: "A child without send_message has no way to await its reviewer's report inside a run: waiting goes through a dummy sleep command"
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "Had to launch an empty sleep command as the wait carrier and then stop it; the wait ended with 'The operator ended this wait', though the reviewer's report ended it, not the operator",
    "command": "bash `sleep 580` waitMs 0, then wait_command {execution, incarnation, waitMs: 585000} — to hold the run until the report of the spawn_agent-launched reviewer",
    "expected": "One door holds the run until a child's report (or wait_call/wait_command take a child's address), and the wait's end names the cause correctly: the reviewer report arrived"
  }
---
Filed from project `runlith`.

The birth note of a child agent says "you hold no send_message… the last message of the run your task arrived in is what reaches it", though `send_message` is in the tool list. If such a child launches a reviewer on its own task and ends the turn, the parent gets an intermediate phrase as the final answer, and the reviewer's report opens another run whose end sends nothing. So the run has to be held: `wait_call` needs the call's address (runId + toolCallId), which a child's report has not; `wait_command` does not promise the report interrupts the wait. The workaround that worked: `bash sleep 580` with waitMs 0 and `wait_command` on it; the report arrived after ~10 minutes of waiting and interrupted it, but with the text "The operator ended this wait". Cost: a spare command, its stop_command, and misattributed cause. Thread: 01a151cf-d5a7-771c-b1b2-c9b12f6e1ece, reviewer 01a151e0-36b0-7ad3-92fa-c0ee5d5c20be.
