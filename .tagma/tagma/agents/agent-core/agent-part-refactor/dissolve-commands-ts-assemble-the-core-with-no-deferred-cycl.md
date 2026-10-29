---
id: 01a11901-5360-733e-9ca2-9126863f579c
title: Dissolve Commands.ts, assemble the core with no Deferred cycle, split host config into ports
ord: 24
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd27337d0bb
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-911fc86fbefa
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-9124eb2a5ae8
---
Implements [[7337d0bb]]. Moved over from [[c86fbefa]]: skills and MCP servers register in the `ThreadToolRegistry` as sources once the Tagma `ThreadContext` is available at registration time without late services. Start with `thread/run/Commands.ts`, `thread/AgentHarness.ts`, `thread/ThreadPorts.ts`, the Tagma `native-harness/kernel.ts`.
