---
id: 01a140dd-4480-705f-8221-0dc783aafa45
title: The Load panel and status bar show Tagma and its agents, and the whole Mac as a footnote
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a140c4-0e0b-7fa3-88b8-d23c3cc8a403",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11b5e-918b-7fdb-80da-5009552ae607
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadPanel.svelte
  - kind: file
    ref: apps/tagma/server/src/executions/contract/wire/load.ts
  - kind: file
    ref: apps/tagma/server/src/executions/load/list.ts
---
The operator wants the Load panel and status bar to show how much of the machine Tagma, its agents and everything they launched eat, not the whole Mac's load; total machine load stays a footnote. Mockup: http://localhost:5634/a/dadcc50eb6cf.

- Server (`executions/load/list.ts`, `contract/wire/load.ts`): a row knows whose it is — `installation`, `agent`, `work` (a thread-less execution), `program`, `kernel`; the view carries `own`, `agent`, `work`, `outside`, `others` totals, a history point Tagma's share; `top` is Tagma's heaviest row; only non-Tagma rows collapse. `read_machine_load` answers the same.
- App: header — Tagma CPU and memory large, under them Tagma's share bar in the machine and the "Mac in total" footnote; chart — Tagma row layers over the machine shadow; list — Tagma, Agents, Terminals and commands, collapsed Rest of the Mac; status bar — Tagma figures, the machine in the hint.

Done when the server and app typechecks pass, `list.test.ts`, `machine.test.ts` and the view-reading app tests are green, and Sol xhigh has reviewed.

## Outcome

Landed in `c8409a7d8d` and `02136c3845`. Sol xhigh's review found four defects, all fixed in the second commit:
- Tagma CPU no longer hides when machine CPU is unread;
- an unread population yields `—`, not `0 B`; a partially read total shows with `≥` and a cause;
- read compression under the frame envelope (`bounded` in the execution host) no longer moves Tagma work into "Other programs" — the [[e88fa891|read-compression]] note;
- hovering a Tagma row with no layer of its own on the chart highlights Tagma's shared layer instead of dimming it.

Verified: `list.test.ts`, `machine.test.ts`, `ProcessUsage.test.ts`, `Readings.svelte.test.ts`, `Row.svelte.test.ts`, `StatusBar.svelte.test.ts` green; `execution-host` typecheck clean; the app's svelte-check — 6 errors only in others' `Peek.svelte`, `ThreadSlot.svelte.test.ts` and `launch.test.ts`; the panel captured in its own `tagma:try` instance with a loader terminal, group search and "Rest of the Mac" checked.

Unproven: its own server typecheck after the review fixes didn't fit the command rule's 3 minutes at load average 44; a full `bun check` by another session on the same tree gave 2 errors only in others' `submitMoving.itest.ts` and `graph/operations/blocks.ts`. The "Agents" group wasn't captured live — the trial instance had no agent.
