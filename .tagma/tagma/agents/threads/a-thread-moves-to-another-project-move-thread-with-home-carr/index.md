---
id: 01a17f1c-bd6b-776b-a00f-dc252a0c2131
title: "A thread moves to another project: move_thread with home carries the checkout and the home in one operation"
ord: 77
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1274e-1d4c-7756-b0f8-edeb9105ff3f
  - kind: relates
    to: 01a14bae-6720-7d62-897a-929587c73bc6
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/targets/decide.ts
  - kind: file
    ref: apps/tagma/server/src/threads/targets/moves.ts
---
## What the user gets

A thread started in the wrong project, or one that outgrew its own, continues in another project with no new thread: the same conversation, the same tasks, the same unhanded rows. The operator tells an agent "move yourself to project X" or "move your subagent to X" — the agent calls `move_thread` with `home`; the operator does the same from the thread menu: "Move to project ▸ <projects>". From then on the thread stands in X's list, lives by X's law, and starts agents from X's library; the thread's open feed in the window moves to X on its own.

## Resolution: one operation for "where the thread stands"

`move_thread` already answers which checkout a thread works in. Moving to another project is the same question with a different answer: the target becomes a checkout of any registered project, and the thread's home moves to that checkout's project. A new operation would give two acts for one thread place and two implementations of one step boundary, rights and refusals.

The home moves together with the checkout rather than staying behind: a thread whose checkout is in B while its list, law, command rules and agents come from A is not a move but working in a foreign place, which already exists (`workdir`, `project`). A user moving a thread wants the thread to belong to B.

Input: `home` — the target project by name or id (by default the thread's home, i.e. the current worktree-to-worktree move), `worktree` — `main` (now the default), a worktree name, or a root id **in the target project**. The answer on every branch carries `projectId` — the home the thread gains through this move. The call site still derives from `threadId`: the call stands in the thread's current home. The field is not named `project`: the call admission reads a `project` field as the call's own place, and the call would stand in the target project and receive `place-mismatch` from `threadId`.

## When the home moves

- A thread with no running run moves at once: checkout selection and home move are one write unit.
- A running thread moves on the nearest step boundary: checkout selection, new context-generation publication and home move are one boundary transaction (the core-context commit participant). The already-running step finishes in the old home: its commands, row writes and law stay in A. From the next step the thread context — `work.projectId` and the new generation's graph — is in B; that generation's execution world opens for the target project (`WorldRequest.projectId`), not by the home row, which still names A until commit, so the next step's commands are accepted as B's commands. The same participant marks the operation `applied` in the boundary transaction; why so and why every core request carries a participant — [[8a7a122c]].
- Until the boundary arrives, a cross-project move writes nothing but the operation record: if the run ended before the boundary or the server restarted, the move answers `failed`, and the thread stays wholly in A. A half-move (checkout in B with home in A) never happens. Moving between worktrees of one project keeps its current behaviour.

An agent's self-move always reaches the boundary: after the call result the model takes the next step.

## What hangs off the home, and what happens to it

Everything keyed by the "thread and its home" pair declares how it follows the move — as a contribution to the `thread-record/home-followers` point at the home's owner: tables, an optional admission (`admit`, may refuse) and following (`follow`). `ThreadHomes` in `threads` runs everyone's admission, `ThreadRecords.rehome` and everyone's following in one write unit, and after commit enqueues a meta record with the new home into the journal; a new data owner with a home key adds its own contribution, changing nothing central.

- **Thread row**: `project_id` → B; folder (`folder_id`) and pin (`pinned_at`) are A's list business, they are dropped; `reader_order_at` — the move moment, so the thread stands atop B's list instead of falling out of its window.
- **Held rows** (change record): the thread rows' `holder_project_id` → B. Without this the thread's live rows would be judged as a removed holder's rows and revoked. Rows stay in A's checkout and stay with the thread; it lands them with `submit_work` by A's checkout, like any work in a foreign place. The thread's command windows and nobody's observations (`command_window`, `command_unattributed`) are also under the home, otherwise cleanup of ended threads would wipe them.
- **The thread's own command rules** (`command_rule` with `thread_id`) → B. The project and machine rule lists come from B.
- **Places** (`thread_place`): the B row is dropped — B is now home. A is not added: the thread's first changing act in A receives A's law via `instructions-unread`, as in any foreign place. Copies with work (`thread_copy`) are untouched: by them the thread's end hands over the tasks it holds in A.
- **Law, settings, project notes, skills, agent library** are read by home on every step — from the next step they come from B. The frozen prompt (agent-definition composition) does not change: B may lack the same definition, and a silent rebuild would refuse or swap the agent; the operator rebuilds it with `refresh_thread_instructions`.
- **Tasks the thread holds**: the holder is the session, it does not change; `HeldTasks` reads the home, roots and working copies, so A's tasks stay visible and hand over at the thread's end.
- **Journal**: the rollout file lies in the project directory where it was born (`threads/<project>/<thread>.jsonl`). A move does not shift it: the journal directory is a journal fact, and a home-changed thread remembers it in `thread_journal_place`. The move does no file operations and leaves no window where a failure would split the file and the home row; an offloaded (rested) thread, whose journal is only the file, moves the same way. Post-move journal meta names the new home; recovery from rollout takes the journal place from the file's directory and writes `thread_journal_place` when it diverges from meta's home. On the step boundary meta is written via the journal queue, not at once: the boundary commit runs under the thread journal's hold.
- **Conversation, scratch, attachments, the operator's thread notes, subscriptions, inbox, questions and approvals, mandate (mode, delegation)** are keyed by thread alone and travel with it unchanged.
- **Tree**: parent and children do not change; cross-home trees are already supported. Children stay in their homes — a move shifts one thread; the agent may move its descendants too.
- **Running work**: a background terminal or command belongs to the project it runs in and to a holder from that project (`transfer_terminal` likewise takes execution outside its project nowhere). While the thread holds a terminal, its command still runs (a `command_wait` exists) or custody handover is undecided, the move refuses `executions-held` with their list; the way out is to await the end, stop them, or hand them to the operator (`transfer_terminal` with no `thread`). The check stands both at decision and in the boundary transaction: a command started after the decision in the same step also stops the move.
- **Custody notices** address the thread wherever it lives: the notice's execution project and operations stay the same, and sending no longer requires the thread's home to match the execution project.
- **A CLI thread with a running run** refuses `harness-pinned`, a thread on a guest host — `guest-mobility`: as now.
- **Plugins**: the thread's `bindings.plugin` stays; plugin tools are those visible in B.
- **Archive**: an archived thread moves into B's archive, no special case.
- **Window lists**: the thread's row leaves A's feed and appears in B's feed in the same delivery as after a home change at the row (`announceThread`): a row under an A parent stays where the parent's family holds it.
- **The thread's open feed**: the thread snapshot carries its home (`projectId`). A main slot whose project differs from the shown thread's home immediately navigates to the thread's address at its home, replacing the history entry, so the window address — the project's first segment — follows the thread, whoever moved it. A side tab reconfigures in place — same key, new home in the id — with no close, open or activation: a hidden tab does not steal the shown one.

## Rights

As with `move_thread`: an agent moves itself and spawned threads, another's thread — on the operator's word (`outside-subtree`), the operator — any thread. The target project must be registered and not removed (`unknown-project`, `ambiguous-project`).

## Window

In the thread menu next to "Move to worktree" — "Move to project ▸" with the machine's other projects listed; the choice moves the thread into the project's main. Another project's worktree is picked there, with the existing "Move to worktree". The item shows for any unarchived thread except a guest one; a server refusal shows as a notification.

## Owners

- `thread-record`: the `home-followers` point, `ThreadRecords.rehome`.
- `change-record`, `executions`, `threads`, `speech`: participant contributions.
- `executions`: the execution world takes the project from the world request.
- `threads`: `ThreadHomes`, `move_thread` (catalog, body), placement in the target project, `ThreadTargets` and the boundary commit, journal (`thread_journal_place`), feed snapshot with the home.
- `native-harness`: the core transaction record set includes participant tables.
- App: thread menu, thread slot.

## Acceptance

- The operator moves an idle thread to B: the thread is in B's list and not in A's; its next run receives B's law and not A's; its rows in A's checkout stay with it; its own command rule reads in B.
- An agent moves itself mid-run: a `pending` answer, the same run's next step receives B's law, its command is accepted as B's command and runs in B's root, after the run the thread is in B's list, and the same move key asked from B answers `applied`.
- A thread with a background running command does not move: the `executions-held` refusal names the execution.
- A moved thread's journal reads after the move (the feed opens, history intact), the file did not move.
- The moved thread's open feed in the window moves to B.

Implementer checks: itest through the HTTP door and a native run with a scripted model; affected-package typecheck. The operator does the live window check if desired; it is not an acceptance condition.
