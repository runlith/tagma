---
id: 01a0cf4b-e132-768f-b1e8-a4778032a885
title: Should an agent be told at its next turn that the operator typed into its terminal?
ord: 7
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
---
After [[22097468]] the operator can type into an agent's terminal without the agent learning of it. An agent that reads its screen and types the next command could act on a prompt the operator changed under it. A half-typed line is one example; a program the operator interrupted is another.

Two answers are possible: say nothing, because the screen the agent reads is already the truth; or tell the agent at its next turn, the way a transfer does, that the operator typed into it. Unknown: whether agents in practice misread a screen the operator touched, which only watching some would show.
