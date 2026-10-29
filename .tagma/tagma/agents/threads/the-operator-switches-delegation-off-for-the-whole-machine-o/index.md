---
id: 01a0cfe5-01c2-7001-8a4b-b581de1d0e99
title: The operator switches delegation off for the whole machine or for one thread and its team; agents' spawns refuse and working agents are told at their next step
ord: 127
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/agents/composeAgent.ts
    symbol: composed
  - kind: symbol
    ref: apps/tagma/server/src/protocol/settings.ts
    symbol: subAgentDepth
  - kind: symbol
    ref: apps/tagma/server/src/threads/store/mandate.ts
    symbol: threadMandate
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationConfig.ts
    symbol: CollaborationConfig
  - kind: symbol
    ref: packages/agent/src/collaboration/ThreadSpawnTree.ts
    symbol: threadSpawnTreeLayer
---
## Outcome

The operator decides whether agents may start other agents: one switch for the whole machine, and a switch on any thread that overrides it for that thread and the team it starts. Either is set by the operator's own hand or by an agent the operator asked. When delegation is off, an agent's `spawn_agent` and `fork_thread` calls refuse, and a native agent already working reads, at its next model step, that the operator switched delegation off (or back on). Nobody is woken to be told.

## Problem

Agents start sub-agents where the work does not need one: a parent that has already read the zone and written the spec hands a child the same reading, and both pay for it. On a day with little quota the operator has no way to say "nobody delegates today" except repeating it in every conversation. `agent.subAgentDepth` bounds how deep delegation goes, never whether it happens.

## What holds now

- The kernel asks the host a per-thread question for depth (`CollaborationConfig.subAgentDepth`), and the plane reads it in three places: the catalog (`startable`), the voice, and the birth edge in `ThreadSpawnTree.spawnChild` and the participants road of `spawn` [[b7a00ccf]], [[2dd4e03e]].
- Workflow members are born through the same `ThreadSpawnTree.spawn`, not through an agent's `ThreadPlaneAccess.spawn`; a top-level workflow is only started by the operator (`tagma workflow`).
- Settings resolve user → project; there is no thread layer [[5ce01c5b]]. An agent writes a key in its project's scope, and a key with no project scope in user scope [[b709b827]].
- A thread's own facts live on its rows: its authority on `thread`, its title and harness on `thread_record`.
- The turn's world state (`turnContext.ts`) renders once per run. The one per-step road that tells a difference is a `beforeStep` rule carrying its state in the guidance message's metadata — `project-instructions` in `composeAgent.ts`, read back by `instructionSnapshot` [[a71ecfc1]].

## Target model

**Answer.** The kernel declares `ThreadDelegation = { allowed: boolean; setAt: string | null }` — `setAt` is the thread whose own switch decided, null where the host's standing answer did. `CollaborationConfig.delegation(thread)` is the host's per-thread answer, like depth; the kernel stores nothing.

**Resolution in Tagma.** `thread_mandate.delegation` holds a thread's own switch: true, false, or null for "inherits". A thread's answer is the nearest non-null switch walking its spawn lineage from itself to its root, else the key `agent.delegation` (boolean, user scope only, fallback true — today's behaviour). Read at every question, so a flip reaches every thread that has no switch of its own.

**Gate.** `ThreadPlaneAccess.spawn` and `ThreadPlaneAccess.fork` — the verbs an agent's own call reaches — read the answer fresh and refuse `delegation-off`, naming where it was switched off and how the operator turns it back on. Messages, tasks, interrupts, stop, continue, compact and model moves of children already born stay open: switching off ends no work already started. `ThreadSpawnTree.spawn`, which the workflow engine uses for members of an operator-started workflow, is not gated — a plan's birth is not an agent's choice to delegate.

**Prefix untouched.** The tool catalog and the collaboration voice do not change with the switch. Removing `spawn_agent` would rewrite the cached prefix on every flip and would leave a thread switched back on without the tool until its next run.

**Telling.** A `delegation` rule in the Tagma composition, at `beforeStep`, compares the answer's `allowed` with the last one told — read back from the newest guidance state in the thread's messages, sealed by a compaction, and taken as "on" (what the prefix describes) where none was told. It speaks only on a difference, in words the kernel's `CollaborationVoice` owns, and carries the told state in the guidance. A running agent hears it at its next step; an idle one at the first step of its next turn; a thread born under "off" at its first step.

**Writing.** The operator: `agent.delegation` on the settings page's every-project tab; the thread's own switch from the composer (`/delegation`: on, off, inherit), on a draft as well as on a born thread. An agent: `write_setting` for the machine switch (already writable by agents, since the key has no project scope), and a new operation `set_thread_delegation` for a thread of its own project. Agents act on the operator's word, never on their own initiative; the operation's words and the told note say so, and nothing else enforces it.

## Owners and boundaries

- Kernel collaboration plane (`packages/agent/src/collaboration`): the answer's type, the gate at the agent's verbs, the words.
- Tagma composition (`apps/tagma/server/src/harness`): the host answer (lineage + setting), the per-step rule.
- Settings (`protocol/settings.ts`): the machine key.
- Tagma thread storage (`db/thread.ts`, `ThreadStore`): the thread's own switch.
- Operations (`protocol/operations/session.ts`, `operations/session.ts`, the threads capability): the agent's act.
- Surface (`apps/tagma/app/src/lib/features/harness`): the composer's switch and its reading.

## Rejected

- A `thread` scope in settings: every consumer of `SettableScope` — the settings page's tabs and layer arithmetic among them — would move for one key, and lineage inheritance is not a settings concept.
- An approval card on an agent switching delegation on: the operator's decision; agents act on the operator's word.
- Hiding `spawn_agent` when off: see "prefix untouched".

## Acceptance

1. With `agent.delegation` false, `spawn_agent` and `fork_thread` from a native thread with no switch in its lineage refuse `delegation-off`; `send_message`, `send_task`, `stop_agent` and `continue_agent` still work.
2. A thread switched on under a machine switch off spawns (depth still bounds it), and so do its descendants; a descendant's own switch overrides its ancestor's.
3. An operator-started workflow's members are born with delegation off everywhere.
4. A native run whose answer flips reads exactly one runtime-guidance note at its next step; no note repeats while the answer stands; after a compaction an "off" is told again and an "on" is not.
5. A thread born under "off" reads the note at its first step; an idle thread is not woken by a flip.
6. The tool catalog and the frozen prompt of a thread do not differ between delegation on and off.
7. `write_setting` of `agent.delegation` by an agent lands in user scope; `set_thread_delegation` writes a thread of the caller's project and refuses another project's thread.
8. The composer shows the open thread's answer and where it came from, and `/delegation` writes the thread's switch or the draft's pick.

## Standing claims and tasks

- [[2dd4e03e]], [[b7a00ccf]], [[f7da5d99]]: unchanged — absence of `spawn_agent` still means exhausted depth alone.
- [[38616a33]]: the voice gains the delegation words; re-verified.
- [[fcef738e]]: unchanged — the plane stays one source per run.
- The `write_setting` grammar lists the machine keys; `agent.delegation` joins that list.
- New claims written from the code at close: the answer and its lineage, the gate and what it leaves open, the prefix staying put, the per-step telling, the thread switch's storage, the operation, the composer reading.

## Order of building

1. Kernel: type, host answer, gate at `spawn` and `fork`, words; every host (Tagma, conformance) answers.
2. Tagma: `thread_mandate.delegation` with its migration, the lineage resolver, `agent.delegation`, the collaboration config.
3. The per-step rule.
4. `set_thread_delegation`, the socket verb `thread.delegation`, the thread's wire field, the draft's pick at birth.
5. The composer's switch.
6. Claims from the code; close.

## Contract

`CollaborationConfig` gains a required `delegation`; every host in the repository is changed with it. `set_thread_delegation` and the socket verb `thread.delegation` are new; the wire thread gains `delegation: { own: boolean | null; allowed: boolean; setAt: string | null }`, built and read by the same build. Thread creation takes an optional `delegation`.

## Stored data

One nullable column on `thread_record`, default null (inherits); an old row reads as inheriting, which is today's behaviour. Rollback leaves the column unread. The machine switch is an ordinary row of the setting table.

## Who may do what

The operator from the surface; any agent through `write_setting` and `set_thread_delegation`, confined to its own project by the operation's existing project pair. The check lives in the kernel's plane verbs. A failure to read the answer refuses the spawn (fail closed), as a depth that cannot be read does.

## Long-lived things

The switch dies with its thread (the row cascades). Children standing when delegation goes off keep running and reporting; they cannot start agents of their own unless their lineage says so.

## Bounded resources

One answer costs at most one primary-key read per lineage floor — bounded by the depth ceiling of five — and one setting read; the rule pays it once per model step.

## Rollout

A server restart brings the column in with null everywhere and the key at its fallback: nothing changes until someone switches. A run going across the restart reads the rule from its next step.

## Failures

The rule is not critical: a failed read logs and tells nothing, keeping the last told state; the gate reads for itself. A flip racing a spawn call already past the gate lets that one birth land.

## Observability

The note is a runtime-guidance entry of rule `delegation` in the transcript; a refusal names `delegation-off`; the composer names the answer and its origin.

## Out of scope

A foreign CLI's own sub-agent tools (Claude Code's Task and the like) stay outside the switch, and a foreign CLI is told nothing mid-turn: the per-step rule runs in the kernel's loop, which a foreign CLI does not run. Recorded as an idea.
