---
id: 01a14c4e-7d20-7f6a-b9ef-01d5ab839609
title: An urgent question to Holdings never waits for the background judge, and a re-judge costs as much as changed
ord: 48
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b58c7d795b
sources:
  - kind: dir
    ref: apps/tagma/server/src/change-record/holdings
---
An urgent question to Holdings never waits for the background judge, and a re-judge costs as much as changed.

The operator opens a file in Changes while agents work, and the diff draws in 6–20 s. Neither git nor the file watcher is the wait: `read_authorship` waits for a fresh Holdings judge, and the judge is busy with background. The same queue holds everyone asking `Holdings.judged`: landing, retirement, `prepared` preparation.

## What was measured

One measurement on the operator machine: server pid 84653, build `20261017T225531962Z`, October 17 23:00–23:27 UTC, about nine agents in runlith, 12 cores, memory pressure `warning`.
- `read_authorship` answered in up to 20.06 s. Of the 20.03 s answer, 19.4 s were `Holdings.wait`; of the 6.34 s answer, 6.09 s.
- One `Holdings.judge` batch took 12.8 s: probe 4.7 s (of which `ChangeRecord.sessionMoves` 4.0 s), input preparation 5.3 s (one version-text query 5.2 s, of which 2.9 s SQLite execution with 11 busy readers), one path's fold 2.7 s in the `later` band.
- Over those 27 minutes 1827 judges ran, 706 s of work in total, 46 judges longer than 4 s. Event-loop lag reached 1.26 s.
- `git status` in the probe took 100 ms: fsmonitor works.

## Why

- A judge batch holds up to 16,384 paths. An urgent path falls into the next batch together with background and receives its answer only after the whole batch is probed, prepared, folded and recorded. In the worker pool its fold also queues behind background folds.
- A path re-judge reads the full texts of all its standing versions, although the fold memory already holds them folded and the new fold skips them.
- The end of a landing publishes a holdings change without places, and every judge where the thread holds lines re-judges its whole domain, although retirement already named every place the lines left.

## Goal

An urgent question to Holdings waits no longer than preparing one short background slice plus judging its own paths, and a background re-judge costs in proportion to what changed: not the path's history and not the domain size. The freshness contract [[42e8ab57]] stays: the answer comes from a judge that started reading inputs after the request. The `Holdings`, `read_authorship` and client answer shapes do not change.

Build order: [[49c55a3e]] → [[23424bc6]] → [[687ec37e]].

## Scope

- Urgent versus background — in the judge, in the worker pool and on the event loop, plus batch traces: [[49c55a3e]].
- Placeless signals: [[23424bc6]].
- Re-judge cost — version texts: [[687ec37e]].
- Showing a diff without waiting for the judge at all — question [[f2931c99]]: decided by measurement after [[49c55a3e]].
- Move-projection cost in the probe — question [[6a262691]].
- out: client and wire — the same answer, arriving faster; the panel already shows loading.
- out: the Rust file watcher — rescans after an FSEvents restart stay full, but after [[49c55a3e]] and [[687ec37e]] they run in the background as short slices and cost little. The operator deferred the watcher decision.
- out: the second `git status --untracked-files=all` in the dev-build adapter (`checkout-builds/reading.ts`) — module [[2043c3ca]], its own task.
- out: the `CheckoutRows` read queue — the workspace module; opening a file does not wait for it.
- out: `Holdings.settled` and `heldCheckouts` wait for the whole domain to go quiet; under constant background that can take long, but it is unmeasured and unrelated to opening a file.

## Standing work

- [[5b4a6709]] stays: a cold start after restart is a different question. [[687ec37e]] rests on the same fold memory, and without it — at startup or after eviction — a re-judge reads everything as now.
- [[eefb0e60]] is untouched: the operator's glued record keeps the line id and changes its digest, and the prefix comparison in [[687ec37e]] runs over digests.
- [[9129dec4]], [[97b0bee9]] and [[e87e8682]] stay: they are about something else.

## Acceptance

Implementer:
- Holdings itest: while a background fold stands paused, `judged` on a path outside the background answers; a request for a path read in an interrupted slice receives the verdict of a judge started after it, not an empty answer.
- bench `composition/testing/change-record/holdings.bench.ts`: an answer to one urgent path of one order at 500 and 5,000 background paths and at 10 and 200 standing versions of the path.
- after `submit_work`, `Holdings.judge` batches carry only departed lines' places (`holdings.paths`).
- typecheck and the touched itests are green.

Operator, not a close condition: under agent load a file from Changes opens in fractions of a second.
