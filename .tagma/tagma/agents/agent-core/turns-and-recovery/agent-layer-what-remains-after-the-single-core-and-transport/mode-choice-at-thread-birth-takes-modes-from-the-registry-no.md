---
id: 01a151df-e920-73d7-9b09-09dd863c9e16
title: Mode choice at thread birth takes modes from the registry, not from the BUILTIN_MODES literal
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-5640-7f4a-9526-239d66e50fc2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/birth/BirthAuthority.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
---
Mode choice at thread birth takes modes from the registry, not from the BUILTIN_MODES literal. `agent.approvalMode` variants come from the threads module source reading the current `ApprovalModes.declared()` projection. Composition binds `settingControls` to the assembly context, and Settings calls the source when issuing the catalog, so a late registration shows without replacing the static key declaration. Settings never knows the mode registry.

The birth window gets the same `ApprovalModeView[]` through the existing `list_thread_types`: one schema for snapshot and birth, `AgentTypes` keeps the answer, `BirthAuthority` reads it. No separate HTTP door and no new list shape introduced. `BUILTIN_MODES` occurs only inside `packages/agent/src/modes`.

Checked: system set threadTypeDoor 6/6, including plan registration after boot and reading it in settings choices and the birth catalog at once; app ThreadAuthority/ThreadSlot/AgentTypes 33/33; server and app typecheck green, in app only the old a11y warning CastView.svelte:243. Check_law: 19 rules, 0 crossings. One readonly review [[01a1523d-97c4-7b6a-8eca-7b758b8fc7a7|reviewer]] — no confirmed findings.

Outside dependency: the recorded demo world.json still holds the old `list_thread_types` without modes. The [[01a125fe-9260-7644-9a64-589c9bc19e19|demo-record]] owner confirmed `record:demo` regeneration after its own separate tagma:try updates; finishing that regeneration was never checked here. No runtime fallback added.
