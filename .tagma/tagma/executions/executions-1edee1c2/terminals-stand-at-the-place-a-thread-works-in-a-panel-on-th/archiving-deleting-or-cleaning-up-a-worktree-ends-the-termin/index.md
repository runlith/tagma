---
id: 01a0d56a-98f2-7614-833d-29a64f4df24b
title: Archiving, deleting or cleaning up a worktree ends the terminals and commands standing in it when the requester asked and may reach them
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/Finishing.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/endHeld.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/updateWorktree.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/finishing.ts
---
## 1 Outcome

Archiving or deleting a worktree from the app ends the terminals and commands still standing in it, once the operator has seen them in the dialog. The same holds for a merge whose after-act archives or deletes, and for cleaning up. The dialog lists what runs there:

- the place's terminals, each with what runs in it, from the host's process evidence;
- an agent's terminal, with its holder;
- a command, with its owner.

It says the act ends them. Confirming ends them and finishes the worktree in one act, with no shell to close by hand first. An idle shell is listed as a count and ends without a word.

## 2 Problem

With [[91f03b67]], every worktree has its own shells. Archive refuses `root-in-use` while any of them stands (`WorktreeFinishing.unused`). The operator would have to close each tab of a worktree by hand before archiving it — the busywork a place that owns its terminals should remove.

## 3 What holds now

- **Archive** (`working/WorktreeFinishing.ts`):
  - refuses a working or waiting agent in the root (`idle`);
  - refuses any use still holding the root (`unused`, `root-in-use`: "end what holds it — a terminal or a command running there — then act again");
  - then commits leftovers, removes the folder and archives the threads standing there (`putAway`).
- **Delete** archives first ([[b57aed5c]]).
- **A merge's after-act** runs archive or delete on the server once the merge lands ([[82d903dd]]). A merge waiting for its base stores the after-act in its pending record ([[893b024d]]).
- **Clean up** archives each chosen candidate ([[e24f991f]]).
- **The finishing operations** (`protocol/operations/finishing.ts`) take no instruction about what runs in the worktree.
- **Ending a thread's executions** has one precedent road: `endHeldExecutions` (`terminals/endHeldExecutions.ts`) stops each under a key of its own as the operator, on thread deletion ([[78edd86f]]).

## 4 Target model

- **The act ends what stands, when asked.** `archive_worktree`, `delete_worktree`, `merge_worktree` (for its `after`) and `clean_up_worktrees` take an optional `endRunning: boolean`. With it, the act does this after `idle` and before `unused`:
  - it ends every standing execution holding the root, each under a key of its own derived from the act, by the stop road `endHeldExecutions` walks;
  - it waits for their discharge, bounded;
  - then `unused` judges as today. Anything still holding refuses `root-in-use`, naming it.
  - Without the flag, nothing changes.
- **Who may end what.** The flag spends the requester's own reach over each execution, as `stop_terminal` and `stop_command` do ([[ae1095ed]]):
  - the operator reaches every execution;
  - a thread reaches only its own and the threads it spawned ([[039b2329]]).
  - An execution the requester cannot reach refuses `root-in-use` naming its holder, before anything is stopped. The flag is never a way past custody.
- **A merge that waits keeps the flag** with its after-act, in the pending record. The operator's consent at queue time is what the server-run after-act spends.
- **The app's dialogs.** The merge, archive, delete and clean-up dialogs read what stands in the place — `TerminalPlaces`' tabs of that root ([[91f03b67]]) and the command fold's lines with that root ([[e8d26502]]) — and list it. They pass `endRunning: true` whenever they list anything. Nothing stands → nothing is listed and nothing is passed.

## 5 Owners and boundaries

- **The server's finishing owner**: `working/WorktreeFinishing.ts`, `working/programRun.ts` where the after-act runs, and the pending-merge record. It ends executions through the terminals' stop road, reached as a dependency it already declares (`uses`) or a new one on the terminal faces. It never touches the host directly.
- **The finishing operations** in `protocol/operations/finishing.ts`: their input and grammar.
- **The app**: `features/worktrees/Finishing.svelte.ts` and the dialogs that call it (the merge dialog, `FinishStrip.svelte`, the worktree menus, `Cleanup.svelte.ts`).

## 6 Rejected

- **The app stops each terminal, then archives.** A shell opened between the stops and the act would refuse the archive anyway. A server-run after-act could never do it. The act that removes the folder is the one owner that can end what holds it and prove nothing does.
- **Archive always ends what runs.** An agent archiving a worktree would end the operator's `bun run dev` without anyone having seen it.
- **End only shells, keep refusing on commands.** A worktree whose idle agent left a background command would still need a trip to Processes. The dialog lists commands too, so the consent covers them.

## 7 Acceptance

- A worktree with two idle shells and a `bun run dev` tab: the archive dialog lists the dev server and counts the two shells. Confirming archives the worktree, and the three executions read discharged.
- The same archive without the flag, from `archive_worktree`, refuses `root-in-use` naming the terminals, as today.
- A thread calling `archive_worktree` with `endRunning` over the operator's shell refuses `root-in-use` naming the operator's terminal, and stops nothing.
- A merge queued for a busy base with archive after and the flag archives with the shells ended when the base frees.
- The finishing suites gain these four cases. The stop road's suites are unchanged.

## 8 What becomes of what stands

- [[247b1882]] is rewritten: archive refuses a use still holding the root unless the act was asked to end it.
- [[82d903dd]], [[893b024d]] and [[e24f991f]] gain the flag in their bodies when this closes.

## 9 Order

This lands after [[91f03b67]], because the dialogs read the places.

1. The operation inputs and the pending record's field.
2. The finishing owner's ending step, with its reach check.
3. The dialogs.

## 10 Contract

The operations gain an optional boolean. An older app passes none and keeps today's refusal. The answer adds `ended`: the executions the act ended, so the finishing dialog can say what it closed ([[e398bdc4]]).

## 11 Stored data

The pending merge record gains a nullable `end_running` column. Old rows read false.

## 12 Who may do what

- **Who decides.** The requester, by the flag.
- **Where it is checked.** In the finishing owner, per execution, by the stop road's own reach law, before any stop.
- **If the check is wrong.** A shell of the operator could be ended by an agent. The reach check reuses the stop doors' law rather than a second statement of it, so it cannot drift from them.

## 13 Long-lived things

- **The finishing gate.** The act holds its gate while it waits for discharges, so no second finishing act runs over the same worktree in the meantime.
- **A stop that never discharges.** It leaves the act refusing `root-in-use` with the stop's operation key named, and the stop keeps running on its own ladder.

## 14 Bounded resources

The wait is bounded by the stop ladder's own span — SIGKILL at 10 s ([[60e540b7]]) — plus one watcher round. Past it, the act refuses, naming what still stands.

## 15 Rollout

A restart runs the migration. An app that sends no flag behaves as today.

## 16 Failures

- **The server restarts mid-act.** The stops already sent stand under their keys. The act was not answered, and repeating it re-ends nothing already ended, because each stop's key is derived from the act and the execution.
- **A dropped connection.** It leaves the act running server-side, as every finishing act does.

## 17 Observability

- The answer names what it ended.
- A refusal names what still holds the root and whose it is.

## Built — divergences

- **The pending record keeps who asked, not a boolean (§4, §11).** `end_running` is a nullable text column holding the requester's principal (`operator`, `thread:<id>`, `foreign:…`); null reads as no flag, so old rows read false. The retry of a queued merge spends that principal's reach. A boolean would have let a thread's queued ask be spent as the operator by the server-run retry, past custody.
- **A thread's or a foreign session's flag ends only what it holds itself (§4, operator's word 2026-09-24 for threads).** The stop door for commands admits a descendant thread's command only behind the `command:descendant` permission subject, which archive's own ask does not carry. So a thread's flag ends the terminals and commands that thread holds, and any other execution — the operator's, a spawned thread's, a foreign session's — refuses `root-in-use` naming its holder before anything is stopped. The stop doors let a foreign session stop anyone's work; the flag holds it to its own too, because §6's reason — an agent ending the operator's `bun run dev` unseen — applies to a foreign agent as much as to a thread. The operator's flag reaches everything started in the worktree. Terminals are judged by `TerminalAccess.prepare` with reach `own`, commands by `CommandAccess.prepare` for the requester's own commands only (`terminals/rootExecutions.ts`).
- **Only what was started in the worktree is ended.** A root use holds every root its folder lies in, under or above, so a shell at `~` or a command whose folder contains the worktree holds it too, while its recorded place is elsewhere or none — and no dialog lists it. Such an execution refuses `root-in-use`, naming it as started outside the worktree, even for the operator; it is ended by hand, as before this change.
- **Commands record their place too, extending [[e8d26502]] (§4).** A command record carried no place, so the dialogs could not tell which commands stand in a root without the cwd guess e8d26502 rejected. `command.root_id` is written at admission from the intent's place (the start road already computed `placeOf` for every start), backfilled for standing commands from their held root use by the same rule as terminals, and carried on `CommandRecord`, `CommandView` and the fold's command lines as `place`. The Processes section therefore groups the operator's commands by place as it groups terminals.
- **The dialogs read through a port.** The app's folder order puts `worktrees` below `terminals`, so `features/worktrees/PlaceStanding.ts` declares the reading and `terminals.layer.ts` fills it from the shared command feed: the roster rows of that root (the rows `TerminalPlaces` adopts its tabs from, so an agent's terminal and a harness CLI of the place are listed too) and the live command lines with that place. An operator shell whose host process evidence shows nothing beneath its leader is counted idle; one whose evidence cannot be read is listed rather than counted.
- **Consent covers exactly what was shown.** The app reads what stands again at confirmation, and when something the dialog did not list has started since, it does not act and asks the operator to read the list again. Only then is `endRunning` sent, and only when something stands.
- **The stop key is derived from the root and the execution** (`worktree-end:<rootId>:<execution>`): no finishing act carries an identity of its own. A repeat after a restart re-ends nothing, because an execution already discharged is skipped and a key whose stop reached the host is not sent again; a key settled without reaching the host (the wire was down, or the key expired) is retried under a fresh suffix, so one transient failure does not wedge the worktree.
- **The HTTP archive and delete doors take an optional body**, so an app built before this change, which posts none, still gets today's refusal rather than a schema error.
- **Open: the stops ride the archive's own permission ask.** `stop_terminal` and `stop_command` declare stop subjects of their own; the flag's stops are judged only by the archive's checkout subjects, so a thread's standing permission rules over terminal or command stops do not judge them. The flag reaches only the thread's own executions, which bounds this.
- **The wait** sends every stop at once and polls discharge every 250 ms up to `STOP_LADDER_MS` plus one watcher round (13.5 s), inside the worktree's finishing gate. What still holds after it refuses `root-in-use` naming the stop's key.
- **`ended`** rides on `WorktreeArchived` — so on delete's `archived` and a merge's `after` too — and on each clean-up row. It names what the act stopped; an execution that had already discharged when the act reached it is not counted.
