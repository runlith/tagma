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
- Low makes agents' commands yield to user programs and uses every core when they are free; Lowest uses the platform's stronger reversible background policy where available. On macOS this also favors efficiency cores and reduces disk activity. The operator's terminals, Tagma work around the command, and the server itself stay outside this policy.
- The level applies to the whole proven tree of the command, including descendants born later; the switch hint says how many processes it has reached and how many remain on the previous level, and one card under the switch shows the unapplied or unsaved level and the unmoved processes.
- New commands report the nearest supported starting level. A running command the host cannot move to the chosen level stays as close as the platform allows and is counted as remaining until its end.
- If the host does not answer, the server repeats the level handover until it goes through.

**Limits.** On macOS, running commands move only between their starting level and Lowest: Low does not rise to Full, and Full or Lowest does not become Low. Linux preserves the holder's inherited priority; Low never raises an already lower-priority launcher. Reversible Lowest on Linux requires `CAP_SYS_NICE`: without it a Lowest launch reports Full and a live unsupported move returns a typed refusal, so lowering cannot trap the command at a priority the host cannot restore. Without an execution host or a process-table read, the level does not apply.
