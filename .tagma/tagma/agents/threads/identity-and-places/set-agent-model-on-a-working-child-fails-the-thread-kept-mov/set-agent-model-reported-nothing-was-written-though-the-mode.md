---
id: 01a1362c-facf-7577-a426-e122b8ae66e7
title: set_agent_model reported 'nothing was written', though the model change recorded
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The third call answered from: claude-opus-5-5 high, i.e. one of the two 'failed' attempts recorded the change after all. The refusal lied about the state, and the caller repeats an already-performed act.",
    "command": "set_agent_model(worktree-delete → claude-opus-5-5 high): two calls in a row returned an error, then interrupt_agent, then a third call",
    "expected": "A 'nothing was written' error means the model did not change"
  }
---
Filed from project `runlith`.
