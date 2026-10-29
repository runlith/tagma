---
id: 01a146b3-b0cd-7c6d-9216-80cada88fc5d
title: spawn_agent refuses a written personal file agent as unknown-type, hiding that agents.offered withholds it from agents
ord: 46
tags: ["reflection"]
fields:
  {
    "actual": "unknown-type \"no agent or profile is offered here as tagma-exp\", unblock \"read_agent_library lists the agent definitions this project offers\" — the library lists it, so the way out is hidden; one failed call of three in a row",
    "command": "spawn_agent {agentId: \"tagma-exp\", project: \"gf-tagma\"} after writing ~/.tagma-dev/agents/tagma-exp.md (extends tagma; read_agent previews it)",
    "expected": "The operator's own personal agent starts at his request, or the refusal says the type exists but is offered to the operator alone and names the setting entry that offers it to agents"
  }
---
Filed from project `runlith`.

Cause: a file agent defaults to `to: operator` unless `agents.offered` lists it `to: agents`; the type catalog answers null for "withheld" exactly as for "no such type", so the kernel cannot tell the two apart.