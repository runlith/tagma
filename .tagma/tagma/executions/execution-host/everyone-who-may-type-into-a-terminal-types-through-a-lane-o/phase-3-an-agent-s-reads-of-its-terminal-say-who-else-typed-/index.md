---
id: 01a0cf56-283d-77ed-b27b-f3bf21c657bc
title: "Phase 3: an agent's reads of its terminal say who else typed into it and when, and never open a turn"
ord: 11
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/contract/service/terminals.ts
  - kind: file
    ref: apps/tagma/server/src/executions/operations/terminalReads.ts
---
## 1 Outcome

When an agent reads a terminal it holds, the answer says who else typed into it and when: the operator, or another thread. This holds for `read_terminal`, `read_terminal_screen`, `read_terminal_bytes` and `wait_terminal`. For example: "the operator typed into this terminal at 18:42:10". An agent about to act on a screen the operator touched knows it touched it.

## 2 Problem

After [[22097468]] the operator types into an agent's terminal without the agent learning of it. An agent decides from the screen it reads. If the operator interrupted its dev server, or half-typed a line at its prompt, an agent that does not know acts on a state it did not make.

## 3 What holds now

- **Typing acts pass the server's gate** (`Terminals.input`), whether the operator's lanes or an agent's typing operations send them, and the grant they are checked against names the writer [[0f46b45c]].
- **Two roads bypass the gate:** a starter's stdin handle (`pipeInput`) and the capture instrument's own host. Neither types into a terminal someone else holds.
- **No read of a terminal says who wrote into it.**

## 4 Target model

- **What is recorded.** After the host admits a typing act, the gate records the act's time against its writer, per execution: in memory at once, in the store by the throttle in section 14.
- **Who sees it.** Every read of a terminal answers the entries whose writer is not the reader.
- **What it never does.** Nothing is sent when no read happens: the note never opens a turn and never wakes an agent.

## 5 Owners

The server: the input gate and the terminal read operations in `apps/tagma/server/src/terminals` and `operations/terminals.ts` ([[86856008]]).

## 6 Rejected

- **A message to the agent at its next turn.** It is sent whether or not the agent will look at the terminal again, so it bills a model step for nothing. An agent acts on a terminal by reading it first, which is when the note matters.
- **Every act recorded.** The newest act per writer answers the question, and a list of keystrokes is the byte record's job.

## 7 Acceptance

- The operator types into an agent's terminal, and the agent's next `read_terminal_screen` names the operator and the time.
- The agent's own writes are never listed back to it.
- The note stands after a server restart.
- A terminal nobody else typed into carries no note.
- A refused act leaves no note.

## 8 What stands

The claims over the four read operations under [[8aa8264c]] and [[80346cf6]] survive and gain the field. None dies.

## 9 Order

After phase 1's lane doors [[52d67932]], so the operator's writes arrive under a grant that names the operator.

## 10 Contracts

The four read operations gain an additive field: the writers other than the reader, each with the time of its newest act. Older callers ignore it. A foreign CLI reads the catalog when it connects.

## 11 Stored data

- **A table of its own**, keyed by execution and writer, holds the time of each writer's newest act. It is added by the server store's migration and removed with the terminal's projection.
- **Rollback:** an older server ignores the table, so it costs only the note.

## 12 Who may do what

- **Who sees the note:** whoever may already read the terminal, and never about their own writes. Reads are project-scoped [[f8029d37]], so the note reveals nothing a read of the byte record did not.
- **Who writes it:** only the gate, from the grant, never a caller.

## 13 Long-lived things

One row per writer per execution, removed with the projection.

## 14 Bounded resources

- **Off the keystroke path.** The gate updates memory, and a writer persists the entry at the first act of a burst, then at most once a minute per writer and execution while the burst lasts. The builder names the figure beside that derivation.
- **Rows:** there are as many as an execution has writers, which is a handful.

## 15 Rollout

The change is on the server only. It lands with an ordinary restart, with the migration run at boot, and needs no host change.

## 16 Failures

- **A crash inside the throttle window:** the note names an earlier act of the burst than the last one, and it is never absent.
- **Two writers at once:** each updates its own row.

## 17 Observability

The note itself is the observable, and the gate's span marks when a note is persisted.
