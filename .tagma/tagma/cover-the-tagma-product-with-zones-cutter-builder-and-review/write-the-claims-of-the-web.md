---
id: 01a0ca85-8bf0-74ed-924f-dea578fd87c0
title: Write the claims of the web
ord: 176
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca86-8e4d-71d5-83ad-79c00edba7e8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Write the claims of [[97ae4de6]] from the code, under parent [[97ae4de6]].

Read whole: `packages/agent-tools/src/webfetch.ts`, `packages/agent-tools/src/websearch.ts`, `packages/agent-tools/src/WebSearchSessions.ts`, `packages/agent-tools/src/webTools.ts`. Reference zones for precision (never size): [[d1caad35]] and [[13756ad0]].

Cover: the fetch envelope (size cap, timeout bounds, cancellation spine) and the three formats; the search providers and the session-gate that declares each endpoint once; why sessions outlive runs and who owns their scope; what the ready catalog binds.

Done when: every claim is written from the code and verified, every symbol anchor resolves, `run_doctor` over the area's paths stands clean, and a review of the zone passes.
