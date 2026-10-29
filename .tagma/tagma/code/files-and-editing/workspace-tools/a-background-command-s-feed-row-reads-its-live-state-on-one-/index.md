---
id: 01a0d950-d873-7a99-96e6-09b6972bbdbc
title: A background command's feed row reads its live state on one line, and a wait on a command names it and its budget
ord: 64
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/agent-tools/src/bash
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Conversation.svelte
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/worldTools.ts
  - kind: file
    ref: packages/agent/src/agent/tool.ts
  - kind: file
    ref: packages/chat-ui/src/ActivityStep.svelte
---
## 1 Outcome

A background command in a thread's feed reads as one line that stays true while the command runs. The line shows a `background` chip that pulses while the command runs, the call's title, elapsed time against the limit, the process running now where the host measured one, and the acts: stop the command, give it more time, show its output. When the command ends, the same row reads its ending with no reload. A call that waits on a command (`read_output` with `wait`, `wait_command`) names that command and shows how long it has waited against the budget it asked for. Its two acts are labelled: stopping the wait, and stopping the command. Execution addresses, operation keys and the world substrate leave the head line. They stay one click away in the opened step.

The operator approved the shape published at http://localhost:5634/a/e1323edc7d61, with the deviations named under 6.

## 2 Problem, with its evidence

Thread `01a0d552` (project 7), pipeline 56297, 2026-09-25. The operator read a five-minute `read_output` wait as a hung agent. In fact three e2e jobs were running normally: 375 s in, against 263–428 s on earlier runs.

- The bash row's head carried `running d8aae58c-…:52 · limit 1h · operation toolu_…:2a1e… · world managed · took 117ms` and wrapped onto three lines. `took 117ms` is the launch, not the command.
- Nothing marked the row as background except the verb. The row froze at the launch answer and never learned the ending.
- The wait row read `Reading command output · 5m 21s · run 17m 40s`. It gave no command name and no budget (`wait: 600`), and its red square did not say whether it stops the wait or the command. Its detail was the raw input JSON.

## 3 What holds now

- `packages/agent-tools/src/bash.ts` `runningAnswer`: the facts are `running`/`queued` (the execution address), `limit` and `operation`. `movedAnswer`: the facts are `background` and `operation`. No `reference`.
- `apps/tagma/server/src/harness/capabilities/worldTools.ts` `withSubstrate` appends `world` to every bash answer's facts ([[16bc6bc4]]).
- `packages/agent/src/agent/tool.ts` `ToolDisplayReference` has one kind, `thread`. The door stamps `durationMs` on every settled call ([[56bbf3be]]). `packages/chat-ui/src/ActivityStep.svelte` draws every fact and `took` in the head, which wraps.
- The row's controls come from `CallControls` through `toolActions`: stop the invocation, hand off, limit. They show only while the call stands ([[3a1e14a3]], [[dc751092]]).
- The Tagma surface already reads every project command live through `CommandActivity` ([[b53f8875]]). A `ProcessLine` carries phase, clock against limit, load, stop and limit revision ([[cacb4a15]]), and `CommandOutput` follows a command's output by key ([[751118a9]]). The feed carries each entry's `ending.nativeExit`, which `ProcessLine` does not yet expose. `api.terminals.processes` reads the processes around one execution ([[0df07791]]).
- The host's byte record keeps offsets and no time per byte, so nothing can say how long a command has been silent.

## 4 Target model

**The display contract** (`@runlith/agent`):
- `ToolDisplayReference` gains a `command` kind: `{ kind: 'command', execution, incarnation, operation?, standing }`. `standing` is true when the answer left the command running or queued, and false when the answer carries its ending.
- The display head gains `details`, a list of facts drawn only in the opened step.

**The producers:**
- bash `runningAnswer`: head facts are `limit` alone. `details` carry the execution address and the operation key. The reference is a standing command.
- `movedAnswer`: the same, minus `limit`, since it states none ([[4aac40d3]]).
- A finished managed command names its reference with `standing: false`.
- `withSubstrate` writes `world` into `details`.

**The chat kit** (`@runlith/chat-ui`):
- It draws `details` in the opened step, copyable.
- The door's duration of a call whose display names a standing command is drawn in the opened step as the launch time, never as `took` in the head.
- It gains an optional product port through which a tool step's head status — the facts and duration area — is replaced by the product's live status while the product holds one. With no port, or no status for that entry, the stored head stands ([[5c32a9bf]]).
- A step drawing a product status omits the unlabelled phase clock. The run clock stays.

**The Tagma surface:**
- For a tool entry whose reference names a command, it looks the command up among the thread's `CommandActivity` lines by execution key.
- A held, live line draws the chip, elapsed/limit with the near-limit amber, the current process and the acts. The acts reuse `CommandActivity.stop`, `reviseLimit` and the limit editor. The current process is the newest associated non-leader process's command in the host's report; nothing is drawn when that is unread ([[416453fd]]).
- An ended line draws `exit N` or the signal from `ending.nativeExit`, which `ProcessLine` starts carrying.
- A line absent from the feed window leaves the kit's stored head.
- The opened bash step shows `CommandOutput` for that execution. So Tagma registers a name-keyed renderer for `bash` that draws the kit's command form plus the output ([[4b9065b2]] changes).

**The wait:**
- For `read_output` and `wait_command` calls, `activityIdentity` titles the row with the command's label or its bash call's title.
- While the call stands, the product status reads the waited time against the budget (`wait` seconds, `waitMs`), with a thin bar.
- The acts are `Stop waiting` (the call's stop) and `Stop command` (the execution's stop). Hand-off and limit are not offered on a wait.

## 5 Owners and boundaries

- The display vocabulary is [[ab02f96b]]'s owner in `packages/agent/src/agent/tool.ts`.
- The producers are [[2657028c]] and `worldTools.ts` (Tagma server harness).
- Head and detail drawing belong to [[3afb6b4f]].
- The Tagma joins belong to [[aeb922f0]] (`Conversation.svelte`, `CallControls.svelte`, `activityIdentity.ts`) and [[8aa8264c]] (`ProcessLine` exit).
- The kit knows no product's commands. It knows only the reference vocabulary and the port.

## 6 Rejected alternatives, and the deviations from the approved page

- **Fold the wait row into the command's row.** The page proposed this. Rejected: the fold, stretch counts, the live indicator riding one row ([[35deda37]]) and row pricing all assume one row per call. The wait row stays, and it names the command and its budget instead.
- **"Silent for N".** The page proposed this. Rejected: the record keeps no time per byte, and adding one is a host wire change. The current process answers whether the command is alive.
- **Moving the run clock into a turn header.** The page proposed this. Out: the run clock is already labelled `run`. The unlabelled phase clock is the one dropped where a product status stands.
- **Keeping the addresses in the model text only.** Rejected: [[16bc6bc4]] promises a future reader the substrate off the answer, and the operation key exists nowhere else a person reads.

## 7 Acceptance criteria

1. In the Tagma surface, a new background bash call's head is one line: chip, title, elapsed/limit, current process where measured, and the stop, more-time and output acts. No execution address, operation key, world or `took` appears in it.
2. Opening that step shows the execution address and operation key (copyable), the world, the launch time and the command's live output.
3. When the command ends, the row reads the exit or signal without a reload.
4. A `read_output` with `wait` on that command reads as the command's title with waited/budget, and `Stop waiting` and `Stop command`. `Stop waiting` ends the call and leaves the command running.
5. Without Tagma's port, a background bash row still reads one line: verb, title, `limit`. The addresses are in the opened step.
6. The typecheck passes, and the unit and integration layers pass for `packages/agent`, `packages/agent-tools`, `packages/chat-ui`, `apps/tagma/server` and `apps/tagma/app`. Tests that asserted the old head facts are moved to `details` or deleted where they pinned presentation.

## 8 Claims and tasks this touches

Rewritten from the code after the build: [[16bc6bc4]] (substrate now in details), [[4aac40d3]], [[4b9065b2]] (Tagma now registers bash), [[3a1e14a3]] and [[dc751092]] (wait calls offer other acts), [[ab02f96b]] (reference kinds), [[5c32a9bf]] (the new port), and [[23721986]] if `ProcessLine` gains an ending. New claims: head versus details, the launch-duration placement, and the Tagma command-row join. Open task [[3ba52106]] (a limit shown while preparing) stays independent.

## 9 Order of building

The display contract, then the producers and their tests, then the kit's details, duration and port, then Tagma's bash row, then the wait row, then the claims.

## 10 Contract

`ToolDisplay` gains an optional field and a reference arm. Stored displays decode unchanged. Code older than this change cannot decode a `command` reference, so a rollback re-reads newer rows with their display failing to decode. The server and the surface ship together, so no version skew stands between them.

## 11 Stored data

No migration. Rows written before the change keep their stored facts and read as before; only new calls take the new shape.

## 12 Who may do what

A stop or limit from the row goes through the same command door as Processes, as the operator's explicit act ([[ae1095ed]]). `Stop waiting` goes through the call control ([[197747d4]]). The server checks both, as today.

## 13 Long-lived things

No new subscription. The conversation reads the project's existing `CommandActivity` feed through the thread's view, started under the activity's scope ([[fc9d17fb]]). The process read is asked only for live rows on screen, when the row mounts and when a feed frame moves that execution, and is dropped when the row leaves.

## 14 Bounded resources

The feed's ended window is 200 ([[6cb16dfe]]). A command past it leaves the stored head. The process reads are bounded by the live rows on screen.

## 15 Rollout

Threads running across the deploy keep their earlier rows. Their next bash call answers in the new shape.

## 16 Failures

A feed that is stale or unavailable marks the status as unconfirmed with the reading's own words ([[4b3f4d26]], [[63f29785]]), and never draws a confident clock. A stop whose answer is lost is read back under its key ([[55431181]]). A process read that fails draws no current process.

## 17 Observability

out: the change is a presentation over readings that already carry their own silences. Acceptance is observed on screen against a real background command.

## 18 Divergences found in use (operator's word, 2026-09-26)

1. **A no-limit command reads its elapsed time.** A running background command started with `timeout: "none"` read `— / no limit` for 127 s: the start was derived only from the expiry, which a command with no allowance does not carry. The Held arm of `CommandLive` now carries `readAt`, the server's stamp of when the host's batch answered, and a running command with no allowance starts at `readAt − deadline.elapsedMs` ([[95e652a8]]). Queued, unarmed and decided work still draws no clock.
2. **The current process rides the feed, not a per-row read** (replaces the process read of §4 "The Tagma surface", §13 and §14). The row read `api.terminals.processes` whenever its phase or load moved, and load moves every sampling round: the installed server answered 1,258 such requests in 5.5 minutes, about 4 a second. `CommandReading` gains `current` — the identity of the newest non-leader process in the command's usage tree and the command the host's process report names for it — composed by the shared command feed, which reads the report only when that identity changes ([[71c5c61e]]). The row makes no read of its own. The host contract is unchanged: its usage round already carries each process's identity and association, and no command text.
