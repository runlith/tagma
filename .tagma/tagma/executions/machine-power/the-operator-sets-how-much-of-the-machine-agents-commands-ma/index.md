---
id: 01a0d631-174b-7f7c-8687-63c3a9f87123
title: The operator sets how much of the machine agents' commands may take — Full, Low or Lowest — from the footer, applied at once to running and new agent work only
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/frame/Awake.svelte.ts
  - kind: file
    ref: packages/execution-host/native/src/process.rs
  - kind: symbol
    ref: apps/tagma/server/src/power/keys.ts
    symbol: agentWork
---
The operator chooses how much of his machine agents' commands may take, from a footer menu beside "Keep this machine awake": **Full**, **Low** or **Lowest**. The choice acts at once on the agent commands already running and on every one started after it, and survives a host replacement. It never slows the operator's own terminals, Tagma's own work around a command, or the server.

## 1. Observable outcome

- A footer menu, next to the keep-awake mark, shows the level that stands and offers three:
  - **Full**: agents' commands run as they do today;
  - **Low**: they yield to the operator's programs but may use every core when nothing else wants it;
  - **Lowest**: they run almost only on the efficiency cores, with their disk access throttled.
- Choosing a level moves every running agent command's processes to it within a second or two, and every process those commands start afterwards inherits it.
- The operator's own terminals, a command he launched himself, Tagma's checkout measurement before and after a command, and the Tagma server and its store processes keep full priority at every level.
- The level is read by the host again after a replacement, so a new host generation keeps it.
- The mark shows the level the host reports it applied, not the one asked for, and it says when a level could not be applied.

## 2. Problem, with evidence

Measured on 2026-09-25, with about a dozen agents working:
- about 10.5 of 12 cores (M2 Max: 8 performance, 4 efficiency) were busy, a third of it kernel time, and about 115 processes were started per second;
- the operator could not work on his own machine, and stopping agents is not what he wants.

A manual `taskpolicy -b -p` on the execution host showed both the gain and the trap:
- every command the host started afterwards inherited background priority (`ps` pri 4 instead of 31), confirmed on a command and its child;
- but so did Tagma's own `git status` checkout measurement around each agent command. A 0.25–0.3 s reading took about two minutes on the loaded machine, and a `sed` that ran in 0 s was shown running for 1 min 49 s.

It was reverted the same minute. A level has to reach only the agent's own command.

## 3. What holds now

- `power.keepAwake` is a user-scope choice setting (`protocol/settings.ts`). The server's power area ([[138cbf2b]]) holds the machine awake from it and publishes a standing, and the surface's footer menu ([[c9967b02]]) writes the setting and draws the standing.
- The execution host (`packages/execution-host`) launches commands and terminals. A native launch goes through `native/src/process.rs` (`Command::new`) and a pipes launch through `PipeProcess`.
- An execution has an owner (a thread, the operator or a service) and a purpose. The checkout measurement around an agent's command runs as separate `support` executions of the same call.
- The host keeps each execution's proven process set with a watcher that grows it ([[719e56e9]]).

## 4. Target model

- **Setting.** A new user-scope choice setting, `power.agentWork`, with values `full` (the fallback), `low` and `lowest`.
  - It is the operator's alone: a thread's settings write of this key is refused, because an agent must not be able to raise its own priority.
- **Scope.** A level applies to agent work only:
  - an execution whose owner is a thread and whose purpose is its command;
  - a harness pty that serves a thread, because it is that agent's work.

  Support executions, operator- and service-owned executions, and the server's own processes are never touched.
- **Mechanism, decided by measurement in step 1.** Candidates on macOS:
  - QoS at spawn: `posix_spawnattr_set_qos_class_np` with `QOS_CLASS_UTILITY` or `QOS_CLASS_BACKGROUND`;
  - darwin background on a running process: `setpriority(PRIO_DARWIN_PROCESS, pid, PRIO_DARWIN_BG)`, which children inherit;
  - `nice` for Low where no QoS change is possible on a running process.

  Low and Lowest each take the mechanism that can be applied both at spawn and to a running process, with the effect the operator was promised. Where a level cannot reach a running process, it applies to new ones, and the standing says so.
- **Running work.** On a change, the host applies the level to every member of each in-scope execution's proven set, and removes it on a move back to Full.
- **Platforms.** Other platforms answer the level as unavailable; nothing pretends to apply it.
- **Test time limits** are not changed here. Whether Low or Lowest makes per-test timeouts fire falsely is measured and reported in the close.

## 5. Owners and boundaries

- **`packages/execution-host`** owns applying a level at spawn and to running proven sets, and reporting what it applied. The executions protocol carries the level and the report.
- **The server's power area ([[138cbf2b]])** owns reading the setting, handing the level to the host, re-handing it to a new host generation, and publishing the standing.
- **`protocol/settings.ts`** owns the key and its operator-only write.
- **The surface's footer ([[c9967b02]])** owns the menu. It writes the setting and draws the standing.

## 6. Rejected alternatives

- **The whole host at background priority** — what was tried by hand. It slows Tagma's own measurements and the operator's terminals.
- **Fewer parallel test workers per agent.** Ten agents at two workers each still fill the machine, and it does nothing for typecheck or builds.
- **An automatic mode by the operator's idle time.** It is worth having, but it is a policy on top of these levels; out of this decision.

## 7. Acceptance criteria

- At Lowest, a running agent command's processes and a child it starts afterwards read background priority. Back at Full, they read normal again, while still running.
- At every level, the operator's terminal, the support executions and the server read normal priority.
- The level survives a host replacement.
- A thread's write of `power.agentWork` is refused.
- The footer mark shows the level the host applied, and shows a failure to apply.
- Measured and named in the close: a fixed CPU-bound workload's wall time at each level on an idle and on a loaded machine, and whether the checkout measurement's time stays unchanged across levels.

## 8. Claims and tasks this touches

- New claims under [[138cbf2b]] and [[c9967b02]], and under the execution host's area for applying a level.
- Nothing standing dies.

## 9. Order of building

1. Measure the mechanisms on this machine: at spawn and on a running process, inheritance, and removal.
2. The host applies a level at spawn and to running sets, with the report, and the wire change.
3. The server setting, handing the level to the host, and the standing.
4. The footer menu.

## 10. Contract

- The executions wire gains the level and the report, and its version rises.
- A host that does not speak the new version reports the level as unapplied instead of pretending.

## 11. Stored data

- One user setting; no migration. Rollback: an older server ignores the key.

## 12. Who may do what

- The operator alone, through the setting; see §4.

## 13. Long-lived things

- The level is a standing the server re-hands to every host generation.
- Nothing is left behind when a command ends: its processes carry the level to their end.

## 14. Bounded resources

- Applying a level walks the in-scope proven sets once per change, bounded by the host's existing set caps.

## 15. Rollout

- The fallback is Full, so nothing changes until the operator chooses a level.
- Because of the wire change, the host must be replaced to deliver this.

## 16. Failures

- A process that exits between the listing and the call is skipped.
- A call that fails is reported in the standing as partly applied, naming the count.
- A host restart re-applies the standing level to new work only; see §13.

## 17. Observability

- The footer mark shows the standing and its applied state.
- A command's read (`read_commands`) names the level its processes run at.
