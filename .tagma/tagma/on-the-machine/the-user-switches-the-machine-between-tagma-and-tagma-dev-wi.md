---
id: 01a14c05-71a7-71c8-88a1-ee4e7b385f80
title: The user switches the machine between Tagma and Tagma Dev with separate worlds
ord: 21
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4d46fcae8c
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4fd8a24944
sources:
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/server.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/channel.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/switch.ts
---
**Value.** The user can keep a plain and a developer Tagma with different data, without pointing hooks and MCP at the wrong one.

**How.** The Tagma and Tagma Dev apps, their CLIs; `tagma switch` and a switch action on the window's waiting page.

**Behaviour.** Channels have separate app identity, directories and addresses. The machine's shared entry points at the active channel. Finding another active channel, the window shows it and offers to switch; switching ends its server, agents and execution host, then raises the selected one. It can only free the place, leaving the launch to the window.

**Limits.** This is switching installations on one machine, not syncing their worlds and not choosing an agent model. Plain work allows one active channel through the shared entry; an isolated trial server of its own is a separate mechanism. Switching interrupts runs, unlike a clean restart of its own server.
