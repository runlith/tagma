---
id: 01a14c05-71a7-71c8-88a1-ee4cea7d76f8
title: The server hands its place to the chosen installation, keeping terminal and command processes
ord: 19
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14bc0-75ae-7828-aae4-080c8bbb5b03
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/restart.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/window.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
  - kind: file
    ref: apps/tagma/server/src/installation/voice/status.ts
---
**Value.** The installed new code takes over without killing terminals and background commands.

**How.** Restart from the installation chip, `tagma restart`, `restart_server`; an installation may request it as its last step.

**Behaviour.** The working server prepares a successor and hands over the execution host before leaving, closes owners and releases the data directory. The installed server raises the selected installation, a checkout server — the same checkout. A launch or preparation failure before handover leaves the predecessor working. The record keeps phases and the window's client measurements; `report_restart_window` accepts the client's measurement, and status shows it.

**Limits.** Connections drop and reconnect; a terminal process surviving says nothing about its operations staying reachable throughout. Automatic return before an open door belongs to the release attempt. Continuing runs and restoring the client's place belong to their areas. The code sets no guaranteed restart duration for every machine.
