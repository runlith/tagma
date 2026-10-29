---
id: 01a140eb-0a34-75f6-93a0-7be8f4702e26
title: "OperatorNotes holds the footnote set: thread, project, user and built-in areas, nearest-area-first resolution, set budget, one render and three operations"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
One owner holds the footnote set — the `OperatorNotes` service in the `threads` module (`threads/notes/`). It stores notes by area, resolves a thread's effective set, holds the budget, renders the text for every path, and serves the management operations. Delivery ([[1d74527f]], [[49ca1849]]) only reads its answer.

## Note, areas, built-ins

- **Note** — `id` (`[a-z0-9-]`, up to 40 characters) and `text` (up to 1,000 characters; longer refuses `note-too-long`).
- **Areas**, nearest to farthest: `thread` (the thread itself), `project` (the thread's home project), `user` (the operator's whole machine), then built-ins.
- **Built-ins** — module contributions: a module declares them in its manifest (`notes`), composition gathers them into the `BuiltinNotes` port ([[edea5454]]). A built-in cannot be deleted, only switched off. The first is `stance` ([[0815fb9f]]).

## A thread's effective set

1. Candidates: built-ins and notes defined in `user`, the project, and the thread. The same `id` in a nearer area replaces the farther area's text.
2. Whether a note is on is decided by walking areas nearest to farthest: in each area first the switch for its `id`, if absent the `*` switch; the first one found decides. None found — on.
3. Output order: built-ins, then `user`, project, thread; within an area — by write time.

So "switch off all notes in this thread" (`*` off in the thread) also silences a note switched on in the project, and "switch everything on in the thread" brings back one switched off in the project; a note explicitly switched on in the thread is delivered even with `*` off there.

## Set budget

The set rides on every operator message and stays in history until compaction: 2,000 characters of set over 100 messages is about 50k context tokens. So the effective set is capped at 2,000 characters: a write after which the set of the thread it is made on behalf of (or of the project's new thread) would exceed it refuses `notes-over-budget` with the current size and the way out "switch a note off or shorten it". A write does not walk the area's other threads: another thread's set that grew over budget through nearer notes is delivered as is, and that thread's `read_operator_notes` names the overrun. `read_operator_notes` answers with the set size in tokens per message.

## Text

One render at the owner for all paths: the frame line `Standing notes from the operator, attached to every message he sends:` and each note's text as its own paragraph. No inner XML tags: step rules escape markup (`agentSignalMarkup`, `AgentSignal.ts:99-125`), and the hook prints it as is, so one form must read the same on both.

## Operations

Declared in the `threads` module manifest, available to agents and the app. The descriptions set how the agent maps the operator's words:

- `read_operator_notes {project?, threadId?}` — the thread's effective set: each note with text, defining area, state and the area that decided the state; switched-off ones; the set size. Without `threadId` — the set of the calling thread when it is in this project, otherwise of the project's new thread; the same thread answers writes.
- `write_operator_note {scope, id, text?}` — with `text` adds or replaces a note; without `text` deletes the definition ("delete", "forget"). Deleting a built-in refuses `note-builtin` with the way out "switch it off".
- `switch_operator_notes {scope, id, on}` — `id` or `*`; `on: true | false` sets the switch, `on: null` clears it.

The operator's words and the operations:

- "add to my messages …" with no area named — `user`: a note about his own words goes into all his threads.
- "remove this" — a reversible switch-off in the area that currently decides its state, not a deletion.
- "remove all notes" — `*` off in the named area, without one — in `user`.
- "bring everything back" — clear the switches that silence anything in this thread's set.
- A write to `user` changes all of the operator's threads; the operation description says: only on his word.

Every write answers with the effective set after it, and the agent tells the operator what now stands, with no second read. Operations declare no approval steps: trust runs them, review asks, as before any call that is not a pure read ([[06e41b6f]]).

## Storage

- The `operator_note` table of the machine database (entities): `scope_kind`, `scope_key` (`user`, project id, thread id), `note_id` (`*` — switch only), `text` (null — switch only), `switch` (null, `on`, `off`), `written_at`. Key — (`scope_kind`, `scope_key`, `note_id`). A project row also carries `project_id`, a thread row `thread_id`, both with a cascading foreign key: deleting a thread or project takes its rows in the same transaction.
- The settings module ([[b824564e]]) holds the `user` and `project` layers, but not the thread and not per-`id` switches with area walk; two owners of one set would diverge ([[51c66cb6]]). So the whole set lives with `OperatorNotes`.
- `fork_thread` copies the thread area's rows into the child: its history carries the source's notes, and the operator's next words must arrive with the same set.
- Deleting a thread deletes its rows, deleting a project — the project's rows.
- The owner keeps effective sets in memory and drops them on write: delivery does not read the database on every message ([[2393aff1]]).

## What shows it works

The implementer proves it with tests through the operations:

- a project note is visible in a thread's set with area `project`;
- `*` off in the thread silences a note switched on in the project; `*` on in the thread brings back one switched off in the project; an explicit per-`id` switch-on in the thread beats `*` off there;
- `on: null` restores inheritance;
- the `note-builtin`, `note-too-long`, `notes-over-budget` refusals with the size;
- fork carries the thread's rows; deleting a thread and a project drops their rows.
