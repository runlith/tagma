---
id: 01a12337-6328-7454-b38c-3439db476261
title: "Explicit capability is held only by a thread whose overlay names it: its source is always in grant, and tools are handed out by the offer check"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/capabilitySources.ts
  - kind: file
    ref: packages/agent/src/thread/agents/AgentDefinitions.ts
---
An `explicit: true` capability is held only by a thread whose overlay names it; its source is always in grant, and the offer check hands its tools out.

`explicit: true` fits a capability owned by a narrow circle of agents, e.g. a plugin's `plugin:<id>`. An agent with `capabilities: 'every'` and an agent without an overlay do not hold it, even when the base declaration lists it; an agent whose overlay names it holds it, even when the base declaration does not.

The agent's grant assembles without a thread (`Agent.standing`), while the overlay arrives with the thread. So the explicit capability's source always enters the grant, and `capabilityHolds` decides at the source's offer. Removing the source from the grant would deny an app's agent its tools; checking only `overlayHolds` at offer would hand others' tools to an agent without an overlay.
