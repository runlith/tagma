---
id: 01a17f7a-76ef-714e-a5b0-c76f58b1fb68
title: A native run orients on its own start, whoever opened it — like a hosted one; a run past its start does not
ord: 20
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17f69-7cca-7d27-b6b0-831ef7fd2c9d
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/scheduler/openings.ts
    symbol: makeOpenings
  - kind: symbol
    ref: packages/agent/src/thread/transport/native/launches.ts
    symbol: makeLaunches
---
A native turn orients on its own start, whoever opened it — like a hosted one; a turn past its start does not.

A native `turn` run assembles the turn's context at its own start, whatever opened it: an operator word, a task, a message or another agent's report, resuming a stopped turn, adoption after a restart. A hosted run behaves the same: `ThreadHosting.open` orients every turn opening. Without this, the first model request after adoption or resumption traveled without what the thread is still untold — the new place's work note, the fork mark, graph changes — and learned of it only on the next word-opened turn.

Repeating is safe because the turn context reports only what changed since last said (the world-state snapshot, the graph cursor), and the said is stored by the same transaction as the context message.

A turn past its start does not re-orient: the mark is a passed turn or a `context` record in its transcript. That is relaunch after a question answer and adoption of a run that already spoke to the model or recorded context: inserting context mid-turn would have shifted what is already said. Keep-warm (`oriented: false`) and compaction (its own opening road) do not orient.
