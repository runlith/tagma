---
id: 01a14c4e-7d20-7f6a-b9ef-01d649c55a3e
title: Urgent paths are judged in their own batch, background runs in slices that yield to urgent work, and now never queues behind later in the worker pool
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judge.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/requests.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/walks.ts
---
Urgent paths are judged in their own batch, background runs in slices that yield to urgent paths, and `now` never queues behind `later` in the worker pool.

`next` in `holdings/judge.ts` currently puts all urgent paths (`now`) into a batch and fills it with background (`later`) paths up to 16,384. `answer` hands out answers only after the whole batch is read, folded and recorded. So a request arriving during a large batch waits out its remainder and then the whole next batch, where it again lies next to background. An urgent path's fold runs in the `now` band, but in the `Walks` pool (`lines/walks.ts`) it waits for a free worker while background work holds a worker for up to 30 s.

## Decision

- **Urgent work gets its own batch.** While urgent paths stand — those asked about by `judged` or a released `lease` — the batch holds only them.
- **Background runs in slices.** Background paths run in slices of at most 256. That is the boundary up to which the probe still asks `git status` by pathspec (`WHOLE_TREE` in `holdings/inputs.ts`) while input preparation runs in one piece (`PREPARED`). A slice's event-loop work — probe maps and SQL assembly over the path list — grows with slice size, not domain size ([[7a910861]]). `BATCH` goes away.
- **A slice yields to urgent work between paths.** The slice's probe and preparation run to completion. When an urgent path appears during folds, the slice's still-running folds are interrupted. Already-judged paths are recorded and answered, and the remainder returns to `later`. Requests waiting on remainder paths receive no empty answer (today `answer` answers `null` to any batch path without a result): they keep waiting, and the judge started after them answers. So [[42e8ab57]] holds.
- **The pool keeps a worker for `now` only.** Background `Walks` jobs take no more workers than `poolSize` gives today; one more worker takes `now` only. Urgent work may also take a free background worker. On machines where `poolSize` yields one worker, there become two. The added worker's memory is measured at build time and recorded in the task. An interrupted background fold already running in a worker runs to completion in its background worker, and its result is discarded.
- **Every batch is its own trace.** `kick` forks `drain` with the context of whoever woke the judge. That is why all batches fall under one never-closing span: in the measurement one `0c0a7ac8…` trace spans over 20 minutes with 293 spans in one batch. The driver forks without `Tracer.ParentSpan`, and `Holdings.judge` becomes the root of its own trace. Span names do not change; only their parent changes.

## Unchanged

`whole` still expands the whole domain into `later`. Rescanning after an FSEvents restart stays full but runs in slices that yield to urgent work. Answer freshness is unchanged.

## Acceptance

- itest in `composition/testing/change-record/holdings.itest.ts`, through a substituted `Folder` as in the neighbouring freshness test:
  - a background fold stands paused while `judged` on a path outside the background answers;
  - a request for a path from the interrupted remainder answers with the verdict of a judge started after it.
- bench: the answer time to one urgent path is of the same order at 500 and 5,000 background paths.
