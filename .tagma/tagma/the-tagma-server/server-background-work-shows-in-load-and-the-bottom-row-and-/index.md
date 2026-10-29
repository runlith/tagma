---
id: 01a14f27-655b-7b9c-a4a5-f8d22d498c2b
title: Server background work shows in Load and the bottom row, and moving journals to the new shape costs in proportion to the step
ord: 131
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a126f6-6c5e-795a-b256-2e311e57a53b
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c14dac7eb7
---
## Why

The Tagma server loads the machine itself, with no agents and no user actions. Example — the first measurement after the 2026-10-18 restart, one sample on a 12-core Mac. After updating, the server moved 1107 threads lying in the database to the `20261018075806_transport_weaknesses` journal-shape step. The main process took 10–115% of a core, two SQLite processes up to 90% each, about 10 minutes. The user sees "Tagma 12–40%" in the Load panel while doing nothing, with no way to tell what happens and when it ends: the process table folds everything into one server process.

Hence two problems:

1. **Server background work is invisible.** On a weak machine load with no cause looks like a defect to the user.
2. **Moving journals costs out of proportion to the step.** Today's step changes one service header line (`meta.native.capabilities`), yet `rolloutWhole.resident` unloads every thread from the database whole (up to 35 MB, 1–5 s per thread) for it, runs all records (`rolloutEntryForms`, `replay.carryPlan`, JSON parse/stringify — as in the CPU profile), and loads them back. With thousands of threads that is tens of minutes on a core after every update carrying a new step.

## What stands after

### 1. Background work is visible

- **Contract.** The server has one background-work owner: every job running with no user request for longer than a few seconds declares itself — name, one-line reason, "done / total" where the volume is known, and the start. The owner estimates the remainder from the last minute's pace. A single job's CPU time is not shown: jobs run as fibers of one event loop and partly in SQLite processes, and honestly splitting CPU between them is impossible; their shared portion is the Tagma row. A job declares itself through its module's port or its own registration; there is no central list of other people's jobs. The declaration ends with the job, including on failure and on server stop.
- **Load feed source.** The load feed (`executions/load`) carries background jobs next to the Tagma row. A job's CPU is part of the Tagma share, not added to it.
- **Bottom row.** The load button in the status bar, while a job runs, shows a label before the CPU figure. One job with known volume — its name and "done / total". Several jobs or unknown volume — "Background work · N". Hover hint: what, why, roughly how long remains. Click opens the Load panel on the background-work section. No job — no label.
- **Load panel.** Inside the Tagma row there is a "Background work · N" group next to "Agents". Each job: name, reason, progress bar where the volume is known, "done / total", and time estimate. No stop or defer buttons: the work is needed and itself yields to urgent work.
- **What is wired.** Journal migration to the new shape (`ThreadRollout.formLagging`, with volume), the row-exit pass after commits (`Retirer.pass`), and rule remeasure (`enforcement.remeasures`) — without volume. Work under 3 s is not shown. Graph catch-up after restart is not wired yet.
- The operator accepted the mockup: http://localhost:5634/a/b10a6c2b9ec8. Looks follow the app standard tokens, with no mockup-private palette.

### 2. Journal migration in proportion to the step

- **A step touching only the header or tail records (`meta`, `reading`) does not rerun the thread.** A thread lying in the database is neither unloaded nor returned: its journal-lane file forms in place (event lines copied unparsed, only meta lines rewritten), the `reading` in the database forms from the same record, the mark stands on the last step. Database rows about meta are moved by the database migration carrying such a step — no shape step over them is needed. Cost is one streaming file pass: on 35 MB ~0.2 s versus 1–5 s for a full rerun.
- **A full rerun stays only for steps changing `entry`, `payload`, or `message`.** Background alignment already runs one thread at a time, skipping threads currently worked with; opening a thread waits no longer than one alignment. The journal reader applies steps to every record it decodes (see [[1e57a53b]]), so a lagging thread reads correctly even before alignment. Background alignment shows as background work (item 1).
- **What is kept.** The step fixed-point contract; a step refusal is recorded in the mark's refusal and does not spoil the thread; an unloaded thread under the mark reads from the file only (note 2b40d171). A model request from a thread the step touched only in the header stays byte for byte the same — the provider cache does not cool.

## Owners

- `apps/tagma/server/src/threads/journal/` — `rolloutWhole.ts`, `rolloutForming.ts`, `rolloutEntryForms.ts`, `formSteps.ts`, `projectionSweep.ts` (the `formLagging` driver).
- `apps/tagma/server/src/executions/load/` and `executions/contract/wire/load.ts` — the load feed; feature [[4dac7eb7]].
- `apps/tagma/app/src/lib/app/chrome/LoadButton.svelte`, `LoadPanel.svelte`, `LoadRow.svelte`, `features/executions/load/View.svelte.ts`.
- The background-work contract lives in the lower module every declaring module can import (platform or its own kit); ports are declared by lower modules, composition wires them.

## Acceptance

1. A `meta`-only step aligns a database-lying thread with no unload and return: the file's event lines and database rows stay the same, the mark stands on the last step. The file pass is measured on a large thread.
2. Background alignment by a `payload` step shows in Load with progress.
3. A thread aligned by a `meta`-only step sends the model the same request: the database rows it assembles from do not change.
4. During journal migration Load and the bottom row on `tagma:try` show background work, with progress and estimate; after the end it vanishes; a job failure removes its declaration.
5. The existing journal tests (shape steps, unload, return, step refusal) and Load pass.

Operator checks — the live view on their server after restart — are no completion condition.
