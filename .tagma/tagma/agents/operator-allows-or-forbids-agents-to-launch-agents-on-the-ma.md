---
id: 01a14b6d-b1de-7e1a-a118-4a1362b40677
title: Operator allows or forbids agents to launch agents — on the machine, on a thread and its team; a setting bounds nesting depth
ord: 3
---
The operator decides whether agents may launch agents: for the whole machine, for one thread and the team it starts, or back to inheritance. A separate setting bounds how many floors of sub-agents stand under the root.

**How.** The Team/Solo pill in the composer: a click toggles, Alt+click returns inheritance; at exhausted depth the pill shows `current/maximum`. The `/delegation` command (On / Off / Inherit, with who decides now). The `set_thread_delegation` operation — on the operator's word only; `threadId` defaults to its own thread. The `agent.delegation` setting (machine, on by default), `agent.subAgentDepth` (1–5, default 2, also settable per project), the `delegation` field at `create_thread`.

**Behaviour.** When off, `spawn_agent` (including with `fork`) and a new thread birth by an agent refuse with `delegation-off`; a working agent learns about the switch at its next step. Agents already launched keep working and reporting; they are still written to, stopped, and continued; `fork_thread` is not checked by delegation (by the code read). The nearest switch up the birth line decides, otherwise the machine's. Depth bounds only new spawns; a child is told its depth and how many floors remain at birth, and on the last floor spawn refuses with `depth-exhausted`.

**Links.** Launching a child agent; detaching a thread (its delegation then follows its own switch or the machine's).

Code: apps/tagma/server/src/threads/contract/wire/settings.ts#delegation, apps/tagma/server/src/threads/contract/wire/settings.ts#subAgentDepth, apps/tagma/server/src/threads/operations/acts.ts#ACT_PAIRS, apps/tagma/server/src/threads/birth/delegation.ts, packages/agent/src/collaboration/CollaborationVoice.ts#delegationNotice, packages/agent/src/collaboration/spawnLimits.ts#spawnLimits, apps/tagma/app/src/lib/features/threads/native/TeamChip.svelte, apps/tagma/app/src/lib/features/threads/native/commands/delegation.commands.ts
