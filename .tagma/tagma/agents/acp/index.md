---
id: 01a108bd-5060-7141-819c-dd4dad88de8a
title: ACP
ord: 81
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/content.ts"
      },
      {
        "at": "src/toolCalls.ts"
      },
      {
        "at": "src/updates.ts"
      },
      {
        "at": "src/methods.ts"
      },
      {
        "at": "src/state.ts"
      },
      {
        "at": "src/events.ts"
      },
      {
        "at": "src/client.ts"
      },
      {
        "at": "src/agent.ts"
      }
    ],
    "id": "@runlith/acp",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6ef-8083-763c-a499-dea0ffc6963b
sources:
  - kind: dir
    ref: packages/acp
---
Tagma drives third-party CLIs over the Agent Client Protocol and answers over it for Claude Code, and this kit is the protocol language for both sides: Effect schemas of the ACP v1 subset Tagma reads, a pure client machine, and serving the agent side. From an agent frame or a Tagma intention, the client machine produces frames for writing, projection events, and new state; the state is serializable and survives a server restart: pending requests of both sides with acceptance receipts, the read cursor, and uncertainty after a break. The agent side (`serve`) reads client frames from stdin, hands requests to agent handlers in parallel so that `session/cancel` reaches the running turn, and writes answers and notifications. The agent process, byte output, permission decisions, stream feed, and what the agent does mid-turn stay with the caller.
