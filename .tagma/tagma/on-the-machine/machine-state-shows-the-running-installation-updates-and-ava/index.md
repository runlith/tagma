---
id: 01a14c05-71a7-71c8-88a1-ee4b86343018
title: Machine state shows the running installation, updates and available actions
ord: 18
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4cea7d76f8
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/StandingChip.svelte
  - kind: file
    ref: apps/tagma/server/src/installation/cli/server.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/machine.ts
  - kind: file
    ref: apps/tagma/server/src/installation/voice/status.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/offers.ts
---
**Value.** The operator learns which Tagma actually runs, what is already installed and which action is available, without comparing processes and directories by hand.

**How.** The installation chip in the status bar, `tagma status`, `read_machine_state`; detailed and machine-readable output available from the CLI.

**Behaviour.** Reading tells apart the running and the selected installations, the update source, an ongoing installation and its last outcome, the execution host with held work, and the restart record. Before readiness or after a failure, the CLI reads the saved launch state. In a developer build, the distance to sources refers to the installation's own checkout, not to the open project.

**Limits.** The release channel reads the feed at server start and once a day, not on publish: a new release appears in the reading no later than a day after release or at the next start.
