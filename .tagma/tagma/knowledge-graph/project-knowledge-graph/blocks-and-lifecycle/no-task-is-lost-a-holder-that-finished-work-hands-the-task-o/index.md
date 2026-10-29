---
id: 01a16527-352c-7185-bffb-404d3490910c
title: "No task is lost: a holder that finished work hands the task off, landing and closing name the abandoned, ready_work shows it"
ord: 12
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a16462-4b34-7294-9530-f7b587a7ab7d
---
Tasks close on time almost always: of 819 taken since October 11 in runlith, the taker closed 806. Two kinds get lost:
- a task held by a holder that finished work;
- backlog and specs with no work left that nobody names at the right moment.

Measurement, causes, and rejected options are gathered in the analysis report — thread [[01a16509-151f-7593-9b15-10ddf97bd084|backlog-design]], 2026-10-22. The case it all started with is [[87a7ab7d]].

## Causes in the mechanism

- **The holder is bound to the session, not to its work.** A thread's end of work is reported by thread events (`threads/events`), while the holder is changed only by `Tasks.claim/release` (`graph/work/tasks/holding.ts`). There is no port between them.
- **`submit_work` does not name the tasks of taken lines' authors.** It names tasks of only its own session and `taking` sessions (`landing/operations/submit.ts`). For lines taken through `whole` or by dependency, only the holder is named.
- **Closing the last task does not name the spec** left with no work (`endResult`, `graph/operations/answers.ts`).
- **The abandoned is invisible.**
  - "In work" puts every in-work task into each thread's prompt without knowing whether its holder is alive (`prime.ts`).
  - The `ready_work` frontier sees only tasks in initial status.
- **Taking a task from a vanished holder asks the operator.** `heldElsewhere` does not look at whether the holder is alive.

## Operator decisions (2026-10-22)

1. A child that finished work hands its task to whoever gave it the work, with a line on the next step. A root that merely stopped keeps its tasks: it is waiting for its reader. Tasks of an archived or deleted thread with no live parent return to open.
2. The backlog stays. `ready_work` shows the age and author of a task with no performer; there is no automatic closing and no expiry. Tasks a child started and left open are named to its parent in the same line as in item 1.
3. Closing the last task names its spec. The `#spec` text: whoever closed its last task or led the work closes it.
4. A one-off runlith cleanup is done by an agent: it reconciles tasks against the code and the graph, closes what is already done, and brings the rest to the operator as a "close / keep / ask" list.

## Holder standing

The graph asks threads for holder standing through the `HolderStanding` port: `working`, `rested`, `failed`, or `gone`. The port is declared in the graph contract; the thread-events owner fills it with the same derivation that `rested` gives. There is no new stored state. If the holder is a root, only `gone` counts as abandoned: a root that stopped is waiting for its human, and its task must not be taken. If the holder is a child, everything but `working` counts as abandoned.

The `#task`, `#spec`, and commit-rule texts in the doctrine change with the same change as the mechanism they belong to. A spec closes when its tasks are closed.
