---
id: 01a0cfd5-0406-78ac-9191-f6f2c015ce98
title: Thread commands could run only on the managed host, with the platform world removed
ord: 12
tags: ["idea"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/worlds/managed.ts
    symbol: checkoutWorldFor
---
## Question

Should a thread's commands have one substrate — the managed execution host — with the platform world (commands spawned inside the server process) removed?

## Motivation

Everything built for commands — deadlines and command rules ([[8cb4e34f]]), the stop ladder ([[f86edb6b]]), process watching, the inventory, the host's record — exists only on the managed road. A command on the platform road runs unbounded, outside the host: no ladder stops it, no listing shows it. The same agent command therefore behaves differently depending on whether the host answered at one moment.

The platform road serves today (`managedWorld.ts#checkoutWorldFor`, setting `agent.checkoutWorld`):
- **An opt-out setting**, "Platform"; the default is "Managed".
- **A host that did not answer at acquisition** — the whole thread's commands then go platform ([[3787a2a8]], [[dd0923ae]]). This is the largest hole: one missed second of connection silently moves a thread onto the road without rules. A host that fails later answers honestly and never falls back.
- **A thread with no project**, always platform.
- **A git call that writes to its own stdin**, always platform, because the managed road carries no bytes into a child ([[e68a617b]]).

## What removing it needs

1. With no host standing, the server raises one and waits; if it cannot, the command is refused with its reason instead of running inside the server.
2. The managed road carries stdin into a child, so git moves onto it.
3. A decision about the world a thread with no project gets.

Then the "Platform" setting and the platform world go.

## Cost and uncertainty

If the host cannot be raised at all, agents run no command, where today they would run unbounded. The proposer judges an honest refusal better than silent unruled work; this is not yet the operator's decision. Unknown: how often the platform road actually serves today (a count of command records by substrate would tell), and what the projectless threads are.
