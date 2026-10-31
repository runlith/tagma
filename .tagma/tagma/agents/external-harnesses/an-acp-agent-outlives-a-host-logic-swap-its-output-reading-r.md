---
id: 01a19298-4f25-77ac-8109-540b042c9d05
title: "An ACP agent outlives a host logic swap: its output reading resumes from the cursor and a halt that cannot reach the host leaves the session recoverable"
ord: 207
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
---
Seen 2026-10-31 15:23:25Z: the execution host logic was swapped while the server served live ACP threads. The client wire ended, its subscriptions ended `closed`, and `link.ts` maps every ending but `completed`/`gap` to `lost`; `ProtocolProcess.read` then writes the row failure "The host ended the agent output subscription without a completed output record" and the driver halts (stops) a live agent. The halt's `terminals.stop` met the new logic not yet listening (`WireUnavailable`, socket open error), the drive died, sessions went `uncertain`/`stopping`, agent processes stayed alive, and threads 01a191db, 01a1921f, 01a1927e-c8fb, 01a1927e-c8d8 hang with an open run and no turn.

The host spec d86d6647 promises the server consumer reads on from the old record cursor after a logic swap. A `closed` ending (this client's connection ended) is not the agent's output ending; a host unreachable for the length of a swap is not a reason to kill the agent or leave the session dead.