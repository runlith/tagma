---
id: 01a14c14-6895-75c6-80f2-47c3c1a7947b
title: "The operator sets what share of the machine the agents' commands take: Full, Low, or Lowest"
ord: 3
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c43a564ec0
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/PaceControl.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/power/Pace.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/power/pace.ts
  - kind: file
    ref: packages/execution-host/src/Pacing.ts
  - kind: file
    ref: packages/execution-host/src/posix/Tempo.ts
  - kind: symbol
    ref: apps/tagma/server/src/power/keys.ts
    symbol: agentWork
---
**Value.** Agents run builds and tests while the operator's programs stay responsive.

**How.** The Agents' share switch in the Load header and the `power.agentWork` setting in Settings → Power; only the operator may change it.

**Behaviour.**
- Low makes agents' commands yield to user programs and uses every core when they are free; Lowest keeps them almost entirely on efficiency cores with reduced disk activity. The operator's terminals, Tagma work around the command, and the server itself always run at full strength.
- The level applies to the whole proven tree of the command, including descendants born later; the switch hint says how many processes it has reached and how many remain on the previous level, and one card under the switch shows the unapplied or unsaved level and the unmoved processes.
- New commands start on the chosen level at once. A running command the host cannot move to the chosen level it puts as close to it as the platform allows, and counts it as remaining until its end.
- If the host does not answer, the server repeats the level handover until it goes through.

**Limits.** The host on macOS moves running commands only between their starting level and Lowest: a command started on Low does not rise to Full, and one started on Full or Lowest does not drop to Low — it stays on its level until it ends. Without an execution host or without a process-table read, the level does not apply.
