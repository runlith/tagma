---
id: 01a14c14-6895-75c6-80f2-47c43a564ec0
title: The machine does not sleep while agents work — always, never, or as the operator chose
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2aaba2d4d54
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/AwakeControl.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/power/Awake.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/power/awake.ts
  - kind: file
    ref: apps/tagma/server/src/power/sleepAssertion.ts
  - kind: symbol
    ref: apps/tagma/server/src/power/keys.ts
    symbol: keepAwake
---
**Value.** Agents' overnight work is not cut off by the machine sleeping, and without work the machine sleeps as usual.

**How.** The awake control in the status bar and the `power.keepAwake` setting: While working (default), Always, or Off.

**Behaviour.**
- While working holds the machine while the server runs at least one thread run; Always — the whole time the server process runs.
- The state is visible live: holding, released, unavailable, or broken — with a reason.
- This is about the machine the server runs on, not the one where the browser is open.

**Limits.** Only idle sleep is held: a closed lid on battery or an explicit sleep still puts the machine to sleep. Holding exists only on macOS; on other systems the state says it is absent.
