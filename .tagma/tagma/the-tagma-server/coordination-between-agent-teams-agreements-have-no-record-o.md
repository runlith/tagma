---
id: 01a0d85a-0de1-757b-9ea9-f7a93038aadb
title: "Coordination between agent teams: agreements have no record of their own, overlaps are found only by broken checks, and team context is written into every brief by hand"
ord: 42
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Three weaknesses showed up on 2026-09-25, while two teams built one feature in one checkout. The teams were the architecture thread (01a0d3dc) with its builders, and the tests thread (01a0d4d0) with its agents, including `speed-imports`. Messages, tasks, the per-line change record and the graph all worked. Coordination between the teams was still manual.

## 1. No shared board between teams

The split between the teams existed in two places. One was a `send_task` exchange: A, B and C belong to architecture; the runner, `failing.json`, package scripts and the system layer belong to tests. The other was the graph's tasks. No object held the agreement itself: who owns which paths, who promised what to whom, and which contract changes go through which thread. Each lead has to remember it. A third team, or a lead whose context was compacted, cannot read it anywhere.

**Open question.** Could an agreement be a record of its own? Something like a contract between teams: owned paths, promises, and the road for changes. Tagma could then deliver it to both sides' agents and check edits against it. Or is this enough as tasks with holders plus path owners in the graph?

## 2. No automatic detection of overlaps

A builder learns that a neighbour broke the tree only when its own typecheck or tests fail. For example, `build-command-inspections` made `caller` required in `EnforceAsk` while `build-enforcement-fixes` was testing the same code. The change record already knows who holds which lines, and read_changes answers that. But nobody is told when one agent's unfinished change breaks what another agent builds on.

**Open question.** Could Tagma warn when a session changes an exported signature, or a symbol, that another live session's lines read? Could it do so without typechecking on every edit?

## 3. Context is not shared

Every child agent gets its whole brief by hand: the team split, the contract, whose files to stay out of, what the neighbours are doing right now. If the lead leaves something out, the child does not know it. `fork` carries a whole history, and that is too much. The graph carries decisions, but not operational agreements of the moment.

**Open question.** Could a team have standing context that every one of its agents receives, and that updates while they work? For example, a team-scoped rule, or a delivered note tied to the active tasks and their neighbours.

## What would inform the choice

- How often these overlaps cost anything: a count of cases where one session broke another's tree, from the change record and from typecheck failures.
- Whether the existing pieces already solve part of it: rules delivered by scope, task holders, and read_changes.
