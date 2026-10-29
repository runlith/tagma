---
id: 01a1647a-8792-789b-bce3-aca3520bc82a
title: Build the OpenCode Cycle, the private plugin, and event translation into the hosted kit
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16472-6102-7eea-b3b2-337e6b694470
---
Add runner/opencode on the existing hosted kit: a private CLI+client, a typed plugin with the original ToolContext.id, one IPC callback into the Relay, system/catalog per request, and correct message seal/cancel/load. Prove with a real local upstream API; do not copy the shared kit or the Cursor runner.
