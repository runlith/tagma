---
id: 01a13290-a736-7592-b058-4e0a8175b246
title: A thread's change stream holds its checkouts' judges, and the judge's HEAD comes from head watch from the first read
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/changes/stream.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judge.ts
---
A judge with no users and no records closes at once. A thread's change stream and its `read` hold every open checkout's judge (`Judges.hold`) for the whole subscription: otherwise a checkout judge where the thread holds only committed lines would close between measurements, the next measurement would open a new one in the `opening` state, a HEAD shift would never reach the frame, and the commit list would stay the same after amend. `read` takes the judges before `settled`, otherwise a settled judge would close before the stream opened. A `Holdings.read` awaiting `settled` holds one judge until the answer and gets the snapshot pinned when the court settles: separate waiting and reading could open a new judge or land in the next pass. Such a request, like an explicit path court, moves its waiting paths ahead of the background pass.

Head watch hands the first HEAD read over asynchronously, after the judge may already have probed its own HEAD. So the first event is never dropped: equal to the judge's HEAD does nothing, and a judge that judged nothing yet simply accepts it. A batch whose probe read while HEAD shifted to another than its probe puts its paths up for re-court: otherwise its verdicts, folded against the old HEAD, would persist and be declared `current` under the new HEAD. Each stream side holds the checkout's judge and line observation in its own scope and closes it once the checkout leaves the frame. Every HEAD shift is announced to subscribers even when no visible path changed: the frame's commit list depends on HEAD. A landing proof may publish after HEAD handling with a command still open; it updates the commit list separately, without waiting for the lines' durable exit.
