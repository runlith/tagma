---
id: 01a14b4c-ecfe-7d12-b8fb-781fde1f806e
title: spawn_agent and read_thread name a personal agent's thread by its base type, not its own id
ord: 101
tags: ["reflection"]
fields:
  {
    "actual": "Both answer agentId/type \"tagma\"; only the prompt size (26,403 chars, the oracle's) shows the definition was applied",
    "command": "spawn_agent {agentId: \"oracle\", …} where personal oracle.md extends tagma; then read_thread on the child",
    "expected": "The answer and the thread row name the agent \"oracle\", the type the thread was started as"
  }
---
Filed from project `runlith`.