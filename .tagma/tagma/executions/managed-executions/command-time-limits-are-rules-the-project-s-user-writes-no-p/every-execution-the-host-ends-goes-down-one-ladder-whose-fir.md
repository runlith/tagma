---
id: 01a0cf92-69a2-70c8-b0f6-4430f86edb6b
title: Every execution the host ends goes down one ladder, whose first signal follows how the work runs
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionStop.ts
---
## Outcome

Every execution the host ends goes down one ladder.
- **The first signal** means "stop" for how the work runs: Ctrl-C (SIGINT) for a command on pipes, a hang-up (SIGHUP) for a terminal.
- **Then:** SIGTERM 7.5 s after the first signal if the work still stands, and SIGKILL 2.5 s after that.
- **Each step ends the moment everything it targets is gone,** so a program that stops cleanly costs nothing.
- **The ladder is the host's own behaviour.** Callers send no stop figures, and no door takes one. It lands in the same release as stage 1 of [[8cb4e34f]], which removes the profiles the figures came from.

## Problem, and what holds now

- **Stop figures nobody chose:**
  - 5 s in the profiles (`apps/tagma/server/src/protocol/commandPolicy.ts#shippedProfile`);
  - 3 s in the host's own policy (`terminals/executionPolicy.ts`);
  - 3 s on the local `bash` road and in `search.ts` (`ESCALATION_MS`);
  - 5 s in `recovery.ts` (`WIDEST_STOP`).
- **Callers can pass their own figures.** `stop_command`, `stop_terminal`, the HTTP stop, the app's `TerminalsRepo` and `commandWork.ts` all accept a `StopPolicy`.
- **SIGTERM first loses cleanup.**
  - Python killed by SIGTERM runs no `finally` or `atexit`, so pytest leaves its teardown undone, while Ctrl-C raises `KeyboardInterrupt` and cleanup runs.
  - Git drops its lock files on SIGINT and SIGTERM, but killed hard it can leave `.git/index.lock` behind and block every later commit.
  - Interactive bash catches SIGINT, ignores SIGTERM, and exits on SIGHUP, which is what closing a terminal sends.
- **Who gets signalled today.**
  - A pipes stop signals the child's own process group (`PipeProcess.ts#endChild`, [[de2c105b]]). Every `bash` call is `<shell> -c <line>`, and a shell that does not exec its program passes a signal on only because the signal goes to the group.
  - A pty stop signals the leader alone (`native/Pty.ts`).
  - Strays outside the group are sampled when the stop begins (`strayProcesses.ts`).

## Target model

- **Aim.**
  - For pipes, each step goes to the child's process group, as today, and to the strays sampled when the stop begins.
  - For a pty, the first step goes to the leader. On a hang-up the shell passes SIGHUP on to its jobs itself. The pty road has no group authority, because it reaps its child as soon as the child exits. So the later steps go to the retained leader pid while it is unreaped, and to the strays sampled when the stop began. An interactive shell's jobs sit in their own groups, and the strays are where they show.
  - From stage 3 of [[13e3cf43]], the targets are the command's proven set instead of the group plus the strays sampled at the stop.
- **Steps.**
  - At 0: SIGINT for pipes, SIGHUP for a pty.
  - At 7.5 s: SIGTERM.
  - At 10 s: SIGKILL.
  - A step is skipped once every target is gone.
- **After SIGKILL** the host waits up to 2.5 s more for the kernel to reap the targets, then grades whatever remains as residual. So a stop is decided within 12.5 s at most.
- **The natural end.** Sometimes the leader exits on its own and nobody asked for a stop. Whatever of its group is left then starts at SIGTERM, with SIGKILL 2.5 s later. What outlives its leader in the group are the leader's asynchronous jobs, and a non-interactive shell starts those with SIGINT ignored (POSIX), so a first SIGINT would only cost 7.5 s. An explicit stop, a deadline and an abort still start at SIGINT. There the 7.5 s is paid only when something survives Ctrl-C.
- **`destroy`** goes down the same ladder, as it does today. It differs from `signal` only in not waiting for output the kernel has not handed over. The host's own shutdown sweep and the ending of orphans use `destroy`, so a host shutdown also goes down the ladder.
- **Where the figures come from.** 7.5 s and 2.5 s are GitHub Actions' ladder for cancelling a step (docs.github.com, "Workflow cancellation reference", read 2026-09-23).
  - Ten seconds is enough for a test runner to print its summary and for git to drop its lock.
  - The reap wait reuses the last step's length. A process that SIGKILL has not reaped by then is stuck in the kernel, and waiting longer will not free it.
  - On this machine the host store holds three stops of real commands, and all three exited on their first signal.
- **Ending a standing host process** is not an execution's stop. The server sends that process SIGTERM and then SIGKILL after the host's shutdown budget. The budget is derived from this ladder plus the ending reads and phases (`capacity.ts#shutdownMsOf`), and the server's patience (`hostReplacement.ts`, `TerminalHostBoot.ts`) is at least that budget, not a flat 10 s.

## Owners and boundaries

- **The host:**
  - `ExecutionStop.ts`;
  - the backends that signal: `native/Pty.ts`, `nativeLaunch.ts#signalPty`, `PipeProcess.ts#stop` and `#endChild`, `recovery.ts` (`WIDEST_STOP`, `ENDING_PATIENCE_MS`), and `strayProcesses.ts`;
  - the store: `db/schema.ts` (`stop_intent.policy`, `call.budget`) and `ExecutionStore.ts`.
- **The wire:**
  - `packages/executions/src/protocol/call.ts` (`StopPolicy`, `CallBudget.stop`);
  - `capacity.ts` (`ExecutionPolicy.stop`, and so `CapabilityProfile`);
  - `wire.ts`, where the `Stop` request loses `policy`;
  - `stop.ts`, where `StopReceipt.policy` gives way to the steps reached and `ConfirmedEnding` gains the step each process ended at;
  - `capacity.ts#shutdownMsOf`;
  - `executionSpawner.ts` (`budget.stop`).
- **The doors that lose `policy`:**
  - `protocol/operations/commands.ts` (`stop_command`);
  - `protocol/operations/terminals.ts` (`stop_terminal`);
  - `api/terminals.ts` (`stopSchema`);
  - the app's `TerminalsRepo.ts`;
  - `harness/worlds/commandWork.ts` (`cancelling`, `endingFor`, `stopping`).
- **Server readers:** `terminals/executionPolicy.ts`, `terminals/hostReplacement.ts` (`forced`, `stopFor`), `terminals/terminalsLayer.ts`, `terminals/TerminalHostBoot.ts`, `harness/prepareRoot.ts`.
- **The tool:** the local road in `packages/agent-tools/src/bash.ts` and `search.ts` goes down the same ladder on the child's process group. Its `win32` branch keeps its current ending until Windows is supported, since there are no process groups there.
- **The capture instrument:** `packages/llm/src/capture/host/CaptureHost.ts`, `capture/drive.ts` and `capture/host/Exchange.ts`. [[7aec9851]] also touches this directory.

## Rejected

- **A setting.** Nobody has a figure of their own, and work that exits early pays nothing for the wait.
- **SIGTERM first.** It loses Python's cleanup, and interactive bash ignores it.
- **The first signal to the leader alone on pipes.** A shell that does not exec its program would never pass Ctrl-C on.

## Contract

- **What leaves.**
  - `StopPolicy` leaves `CallBudget`, `CommandLimits`, `ExecutionPolicy`, `StopReceipt`, the wire's `Stop` request and every door.
  - The `policy` parameter of `stop_command`, `stop_terminal` and the HTTP stop is removed in the same change that stops the app and the tools from sending it.
  - The command admission's identity stops fingerprinting the stop.
  - The `stop_command` and `stop_terminal` texts keep their meaning for `destroy`.
- **Stop receipts** carry the steps reached, and each confirmed ending carries its step.
- **The wire** rises in the release this change shares with stage 1 of [[8cb4e34f]]: one rise for both.

## Stored data

- **The host's store.**
  - `stop_intent.policy` and `call.budget.stop` are dropped by the host store's migration.
  - Rows an old host wrote are read only to discharge them.
  - A confirmed ending's step is optional in stored rows. One missing reads as unknown, so a row written before the release still decodes.
- **The server** stores no stop figure.
- **Rollback** is forward-only, with the release.

## Who may do what

Out: the ladder decides no authority. Who may stop what stays with [[ea46adc7]] and custody.

## Long-lived things

A stop lives from its first signal until every target is reaped or graded residual, at most 12.5 s. A host replaced mid-stop ends the work through the replacement.

## Bounded resources

- **One stop holds one sampled set.**
- **The host's shutdown budget** becomes the ladder plus the reap wait plus the ending reads and phases, and the server's patience grows to match.

## Rollout

Ships in stage 1's release, landed through a restart while no execution is live, as [[8cb4e34f]] states.

## Failures

- **A target that cannot be signalled** (permission, a stale witness) is named as residual.
- **A leader that exits on the first step while its group stays** does not end the ladder: the group goes on to the later steps.

## Observability

A stop's receipt names the step each process ended at, so a reader can see how often work needs SIGTERM or SIGKILL.

## Order of building

This change is built as one part, because the vocabulary, the host backends, the doors and the app compile only together.

It lands first in stage 1's release, before [[8cb4e34f]]'s part 1. The profiles still stand when it lands, and it removes their stop field, so every later commit builds on the ladder.

## Acceptance

1. **Pipes.** A `bash -c 'sleep 1; python -c "…"'` whose Python catches `KeyboardInterrupt`, prints and exits:
   - is ended by the first step, and the answer shows the Python's output;
   - one that ignores SIGINT gets SIGTERM at 7.5 s;
   - one that ignores both is killed with its group at 10 s.
2. **Pty.** An interactive `bash` ends on the first step (SIGHUP) without SIGKILL.
3. **Groups.** When the shell does not exec, the program still receives the first step, because the step goes to the group.
4. **Doors.** `stop_command` and `stop_terminal` take no `policy`. The app and the tools send none. No stop figure is read from a caller, a setting or a profile.
5. **Patience.** The server's patience for replacing a host is at least the host's shutdown budget.
6. **Shutdown and `destroy`.** A host shutdown with a live command sends that command SIGINT first, and ends it within the ladder.
7. **Strays.** A process that left the command's group before the stop, and was sampled when the stop began, receives every later step.
8. **Receipts.** A stop's receipt shows the step each process ended at.
9. **Natural end.** A command that exits 0 and leaves a background job in its group answers once that job ends on SIGTERM, not 7.5 s later.
10. **Shutdown.** A host shutdown with several live executions stops them concurrently, within one shutdown budget.

## Claims and tasks this touches

Re-read at close:
- [[aa2a5510]] (the local road's 3 s);
- [[6977f1be]] (which replaced [[0e55167d]]), [[069fb3b8]] (which replaced [[2d4013ec]]), and [[82ba4968]];
- [[89188220]] (a shutdown budget of four times the force budget);
- [[de2c105b]];
- the stop claims under [[80346cf6]] that read `forceAfterMs`.

No open task touches this change.
