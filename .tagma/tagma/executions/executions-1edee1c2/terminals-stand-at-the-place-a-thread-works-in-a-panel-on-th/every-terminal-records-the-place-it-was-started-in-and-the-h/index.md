---
id: 01a0d56a-9853-79ac-9ff6-fa60e8d26502
title: Every terminal records the place it was started in and the harness session it was launched for
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/store/terminal.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/launch.ts
  - kind: file
    ref: apps/tagma/server/src/protocol/terminals.ts
  - kind: file
    ref: apps/tagma/server/src/terminals/Terminals.ts
---
## 1 Outcome

Every execution row the server answers names two facts from its start:

- **`rootId`: the place it was started in.** This is the narrowest registered root of the project that contains the folder its start resolved.
- **`launchedFor`: the thread a harness launch serves.** It is set only for the pty a harness session launched.

`read_terminals`, the roster and every `TerminalView` carry both. The app places a terminal by its record, never by a path prefix. It knows a harness CLI's pty from a shell from the first frame that lists it.

## 2 Problem

- **A harness pty looks like a shell.** A harness launch is admitted as the operator (`harnessPlace`, `harness/harnessLaunch.ts`). Its row therefore reads exactly like a shell the operator opened, and the Terminals roster adopts it as a tab ([[ee4c2bc7]]).
- **The place is guessed from a path.** The app guesses a tab's worktree from its folder by path prefix (`Worktrees.holding`, called from `TerminalTabStrip.svelte`). A prefix is not the registry's answer: the canonical checkout contains the project's worktree folder, and a folder that has left the listing matches the wrong row.

## 3 What holds now

- **The row.** `TerminalRecord` (`protocol/terminals.ts`) and the `terminal` table (`db/terminals.ts`) carry the holder, origin, custody revision, holdings (`rootUse`, `environmentUse`), label, command line, program and cwd. They carry no root and no served thread.
- **Resolution.** A start resolves its target (`ResolvedExecutionTarget`), whose `footprint.roots` are the registered roots overlapping the cwd. `named` is the root a caller named. The admission takes a root use for the footprint.
- **The harness launch.** It is `terminals.terminals.start` with `actor: Operator`, `operationId: harness-run:<session>`, `purpose: 'command'`, pty and held.

## 4 Target model

- **The place is resolved once, at acceptance, and kept.** The narrowest root of the start's own footprint — `named` when the start named one — is written to the row as `root_id`. Later reads never re-resolve it, because a place is where a terminal was started, not where its shell has since `cd`-ed.
- **The launch says whom it serves.** The start request takes an optional `launchedFor: ThreadId`. Only `launchHarness` passes it, from the session's thread, and the row keeps it as `launched_for`. Custody is untouched: the operator still holds the pty, which is what lets the harness lane and the operator's views type into it.
- **`TerminalView` carries `rootId` and `launchedFor`** as optional keys, printed by `read_terminals` and `read_terminal`.

## 5 Owners and boundaries

- **The server's terminal store and its start road:** `terminals/Terminals.ts`, `terminals/TerminalStore.ts`, `db/terminals.ts`, `protocol/terminals.ts` and the listing's projection (`terminalView`).
- **The harness launch:** it passes `launchedFor` (`harness/harnessLaunch.ts`).
- **The operation descriptions** of `read_terminals` and `read_terminal` say what the two keys mean.
- **Nothing in the app changes here.** [[91f03b67]] and [[ba15d2f5]] read the keys.

## 6 Rejected

- **Derive the place in the app from `cwd`.** This is today's guess, wrong for nested folders and for gone worktrees.
- **Re-resolve the place at read time.** A registry that moved would move a running shell's place under it, and every listing would pay a filesystem resolution.
- **Mark harness ptys from the harness facet at read time.** Between the host's acceptance and the facet's write, the listing would show the pty unmarked, and a reading in that window would adopt it as a shell. The launch fact is known before the spawn, so it is written with the row.
- **Make the harness thread the pty's holder.** Custody decides who ends the process and who is told. Moving it would change every harness stop, lane and take-over road for a fact that is only a label.

## 7 Acceptance

- After a harness launch, the first `read_terminals` page that lists its row names `launchedFor` as the thread.
- A shell opened in a worktree names that worktree's `rootId`. One opened in main names the canonical root's, even though the worktree folder lies inside main.
- A standing row accepted before the upgrade reads its `rootId` after the migration. A discharged history row reads none, and the listing prints no place for it.
- The existing terminal suites pass, and the store suite gains the migration's backfill case.

## 8 What becomes of what stands

- [[ee4c2bc7]] is rewritten by [[91f03b67]]: the roster classifies by `launchedFor` and `rootId`.
- The `read_terminals` operation text gains the two keys. Its claims under [[80346cf6]] survive.

## 9 Order

Migration and store, then the start road and the harness launch, then the projection and the operation texts. This change lands before [[91f03b67]].

## 10 Contract

`TerminalView` gains two optional keys, and old frames decode without them. The start request gains an optional key that only the server's own harness road sets: the HTTP start door does not accept it from the app, because an operator's shell serves no thread.

## 11 Stored data

- **Migration.** It adds nullable `root_id` and `launched_for` to `terminal`, with an index on `(project_id, root_id)` for [[ba15d2f5]]' place filter.
- **Backfill.** Standing rows (`discharged_at` null) are filled from their held root use, resolved to its root through the registry. `launched_for` is filled from the harness facets that name the row's execution.
- **What stays null.** A discharged row is left null: history needs no place, and its root may be gone.
- **Rollback.** An older build ignores both columns.

## 12 Who may do what

Only the server writes the keys. `launchedFor` is refused from any external start door.

## 13 Long-lived things

out: two columns written once at acceptance; no state machine.

## 14 Bounded resources

out: two fields per row, no new reads.

## 15 Rollout

- A restart runs the migration.
- Running shells and harness ptys keep running and read their backfilled keys.

## 16 Failures

- **The start's footprint names no root.** The row keeps `root_id` null and reads as unplaced: the panel draws it nowhere, and Processes lists it under its owner with no place. The builder reads the admission and states whether such a start can be admitted at all. If it cannot, this arm is dead and is not written.
- **The backfill cannot place a standing row.** A root use whose root the registry no longer answers leaves the row null, and the listing says it is unplaced. It never guesses.

## 17 Observability

`read_terminals` prints the place and the served thread on each row. The migration logs how many standing rows it placed and how many it could not.

## Built — divergences

- **The intent carries the two keys too.** The migration also adds `root_id` and `launched_for` to `terminal_intent`, written at the reservation and backfilled for starts in flight across the upgrade. Without them a start the boot reconciliation projects after a crash (`TerminalReconciliation`) would read unplaced and unmarked for good, which §15 promises against.
- **§12's "refused" is structural, not a refusal code.** No external door declares `launchedFor`: `start_terminal`'s params and the HTTP start payload have no such key and the handler builds the operation input field by field, so a value a caller sends is dropped at decode rather than refused.
- **§16 arm one is live.** An admission's covered set may be empty (a start in a directory on no root of the project), so such a start is admitted and its row stays unplaced.
- **The backfill never guesses past a gone root.** A standing row whose nearest held root is no longer active stays null rather than falling back to main.
- **A named root places a start only when it is this project's and holds the directory**; otherwise the narrowest covering root does.
