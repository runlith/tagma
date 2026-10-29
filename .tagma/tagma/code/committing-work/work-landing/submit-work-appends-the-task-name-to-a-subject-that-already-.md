---
id: 01a155be-2f10-798f-b4a3-c7d20c5bbe70
title: "submit_work appends the task name to a subject that already ends with it: “(482deab9) (482deab9)”"
ord: 84
tags: ["reflection"]
fields:
  {
    "actual": "Commit 7f063e0 got the subject “… hello world app (482deab9) (482deab9)”",
    "command": "submit_work in law-lab with the subject “Add bun workspace with Vite 8 + React 19 hello world app (482deab9)” from a session holding task 482deab9",
    "expected": "The task name stands once in the subject"
  }
---
The agent wrote the task name into the subject itself, as the instruction “A commit for tracked work names its task in parentheses” says, and the door appended it once more. Either the door does not append a name that is already there, or the instruction does not tell the agent to write it itself.
