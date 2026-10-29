---
id: 01a14c14-6895-75c6-80f2-47c97b9b56cc
title: "Terminals and commands live in a separate execution host: it survives the server restart, and its logic updates without finishing processes"
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4b86343018
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4cea7d76f8
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b00fb170e3
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47ca819c7fba
sources:
  - kind: dir
    ref: packages/execution-host/native/holder
  - kind: file
    ref: apps/tagma/server/src/executions/host/boot.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/departure.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/offer.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/terminalBehavior.ts
    symbol: hostMemoryShare
---
**Value.** The operator's and agents' work does not die with the Tagma server and is not cut off by an update: a separate process holds the processes, their bytes, and their screens.

**How.** On its own: the server raises a host of its build at startup and talks to it over a local socket; the `host.memoryShare` setting in Settings → Execution host.

**Behaviour.**
- The parent of processes and the owner of their handles is a small holder; the host logic above it is replaced without closing a single terminal. A server of another build lays its bundle as a candidate and asks the previous logic to yield; the holder itself swaps its image, and if the new one does not start, it returns the previous one.
- A build whose bundle the standing host will not accept does not enable itself: a restart refuses until the previous server leaves, and a published release does not become current and waits nearby. The machine state names what the new host will finish, and consent restarts with the new host, finishing the previous one with its own recovery program and telling the threads about their terminals. The same consent raises its own host for a server that already stands with another's host that did not accept it.
- The host writes every execution's bytes, mirrors the screen, takes input with receipts, keeps terms and the stop, and accounts resources; the record is read even after the execution ends.
- Host memory is limited to a share of the machine: when short, it takes history from the least active terminal before refusing a new start.
- Without a host the terminal panel names the reason, and thread commands run in the platform world.

**Limits.** The holder and host exist only on macOS: on other systems there are no terminals, background commands, Load load, or agent shares. A process surviving a logic change does not rule out a short pause of its operations.
