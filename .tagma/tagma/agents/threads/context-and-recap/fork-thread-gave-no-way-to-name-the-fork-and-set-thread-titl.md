---
id: 01a11971-8221-7e5d-b85d-d36cb8f66f77
title: fork_thread gave no way to name the fork, and set_thread_title was no agent tool
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "fork_thread gave only “fork (<source>)”; set_thread_title was declared in the app's HTTP routes with tool: undefined and never given to agents, though the generate_thread_title description refers to it",
    "command": "the orchestrator forks itself at the operator's request and wants to name the fork at once",
    "expected": "fork_thread takes a name, and an agent renames a thread with its own tool"
  }
---
Filed from project `runlith`.
