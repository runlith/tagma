---
id: 01a1089e-978d-7423-bc88-3a1f9d90bce3
title: "Claude runner over the Agent SDK (tagma harness-run claude): Tagma prompt and tools like a native agent, fork and rewind"
ord: 5
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
  - kind: waits-on
    to: 01a1089e-978d-7423-bc88-3a1de25a0bbf
---
Decisions 2 and 10 of spec [[adb9cd5b]]: Tagma's own `systemPrompt`, Claude Code built-ins off, the native agent catalog via `tagma mcp-serve`. Start by checking whether the MCP door hands the full native catalog to an external process. Done: a Claude thread on `acp` passes checks 1–6 and 11 and is indistinguishable from native in feed and tools, except compaction and provider switch.
