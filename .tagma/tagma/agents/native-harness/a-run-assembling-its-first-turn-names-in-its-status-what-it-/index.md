---
id: 01a13ba2-803d-7614-a6da-3531b01a5749
title: A run assembling its first turn names in its status what it waits for — the place graph or setup worktree — and for how long
ord: 11
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a13ba2-803d-7614-a6da-35301e154af5
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/workLine.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/context.ts
  - kind: file
    ref: packages/agent/src/agent/AgentPhase.ts
  - kind: file
    ref: packages/agent/src/thread/run/assembly/RunAssembly.ts
---
Goal: from run start to its first step, the status line in the feed and the thread row in the list say what the run waits for, counting the seconds of that wait. For example: "Opening the graph of tagma-exp-classes-d74152 · 41s", "Waiting for setup of tagma-exp-classes-d74152 · 12s". A fast opening looks as now. A bare "Working" with no explanation no longer stands for tens of seconds.

## What the user sees now

An `exp-classes` child (thread 01a13b39-13d7-7f4e-9246-c3c3447e2141, 2026-10-14):
- 16:23:46 the feed showed the "Set up <branch>" card: setup worktree finished;
- until 16:24:27 nothing else appeared, while the status stood at "Working";
- all those 41 s the run was assembling its first turn, waiting on the rebuild of the new worktree's graph mirror.

It looked like everything was ready while the agent hung.

Why in code:
- agent phases start at the first step: `enter('preparing')`, `packages/agent/src/agent/AgentTurn.ts:174`;
- the turn context assembles earlier, in `threadAgent.startRun` before `runner.run` (`packages/agent/src/thread/agents/ThreadAgent.ts:370`): the place graph (`native-harness/turns/context.ts:166`) and setup worktree (`context.ts:173`);
- there is no phase, and the feed verdict falls to `'working'` (`packages/chat-ui/src/session/FeedVerdicts.ts:88`).

After the [[1e154af5|mirror rebuild in seconds]] the main wait for a new worktree becomes its setup: here `bun install --frozen-lockfile && bun run --cwd packages/window-behavior build` ran 46 s under load. This spec makes any such wait visible.

## Decision

### 1. `packages/agent` kit: the turn-opening phase

- `AgentPhase.phase` gains `'opening'`: the run assembles its turn before the first step.
- `AgentPhase` gains an optional `waiting: { reason: string; place: string | null }` field — what the opening waits for and where.
  - The kit carries `reason` opaquely: what reasons mean is the product's call.
  - `place` is the place name as the worktree list shows it.
- The `'run'`- and `'orientation'`-kind `ThreadContextUse` gains an optional `waitingOn(waiting, work)` port. The port runs `work` and, while it runs, names it as the opening's wait.
  - `threadAgent.startRun` passes the port from its input into `options.context`, `threadAgent.runContext` from its own (`ThreadRunContextInput`).
  - Orientation is needed: `RunAssembly.native` assembles the orientation context (`doors.runContext`, the `'orientation'` kind) before `natives.start`, and it is the first to open the graph and wait on setup; the `'run'`-kind context later finds them ready.
  - Mid-run context boundaries (`contextBoundary`), `hostRun`, and the outer loop's `runContext` (`ThreadHosting`) do not pass it: the step phase already runs there.
- `RunAssembly.native` (`thread/run/assembly/RunAssembly.ts`) owns the run up to its recorder and publishes the phase to the run band of the live feed (`feed.progress`) through `openingPhase` (`thread/run/assembly/openingPhase.ts`):
  - first, before orientation and `natives.start` — `{ phase: 'opening', since: assembly start }`; assembly start, not `run.startedAt`, because a continued run reassembles much later than its start;
  - `waitingOn` publishes the same phase with `waiting` and `since` = that work's start, but only if the work runs past the grace period. When the work ends — `opening` again with no `waiting` and `since` = the wait's end: an already-named wait is not counted again toward "Preparing the next step".
  - Grace is a named constant with a reason: a sub-second wait would appear and vanish before anyone reads it.
  - The recorder's first phase (`preparing`) replaces `opening`. A start failure ends the run as now, and the band closes with it.

The kit knows nothing of graphs or worktrees ([[e090f46d]]): it declares the port and carries the reason, the product names it.

### 2. `native-harness` product: what the turn waits for

- `native-harness/contract/wire` declares the opening reasons: `graph` — the place graph opens or refreshes, `setup` — setup worktree still runs. The app takes them from there.
- `turns/context.ts` wraps in `use.waitingOn`:
  - `graphAt(target.graph)` — with the `graph` reason;
  - `setups.ready(placedIn)` — with the `setup` reason.

  The place in both is the worktree name from its record (`setups.reading`, read only with the port); for the main checkout it is `null`. With no port (`kind: 'tools'`, boundaries) — as now.

### 3. Thread list

`threadPhaseSchema` (`threads/contract/wire/list.ts`) carries `waiting` from `AgentPhase`, and `ThreadPhaseFeed` (`threads/list/phase.ts`) moves it along with the phase. The thread row in the list says what the feed says.

### 4. `packages/chat-ui` chat kit

`RunVerdict` and `ChatLiveStatus` carry `waiting`. `ChatStrings.livePhase(phase, waiting)` receives it, and `LiveRunRow` passes it. The row time counts from the phase `since`, like other phases. The kit does not interpret reasons.

### 5. App

- **`native/strings.ts`, `livePhase`:**
  - `opening` with `graph` — "Opening the graph of {place}";
  - with `setup` — "Waiting for setup of {place}";
  - with no place — the same words without "of {place}";
  - with no `waiting` — the same words as `preparing`.

  Reason words stand in one place, `waitingWords` (`threads/workWords.ts`), taken by both feed and list row. Its dictionary is typed as the wire `WaitingReason`, so a new reason without words fails typecheck; a reason the app does not know shows the `preparing` words, not the raw code.
- **`workLine.ts`:** `opening` with `waiting` is a row phase of its own with these words and time; without `waiting` it reads like `preparing` (`thinking`).

A fast run start therefore looks as now.

## Why this way

- **The wait is reported by whoever waits.** Only context assembly knows it opens the graph or waits on setup. The kit gives it a port, and no one else reports that fact ([[51c66cb6]]).
- **Grace stands at publication, not in rendering.** List and feed get one truth and keep no threshold each. A one-second display delay already exists — in the list row (`DWELL_MS`, `workLine.ts:5`).
- **The `opening` phase belongs to the run, not the step.** So the run assembly publishes it, not the agent loop: there is no loop yet.

## Rejected

- **A "Setting up…" card in the feed while the graph opens.** The worktree card speaks of its setup, which truly finished; the run's wait is the run's phase.
- **A display threshold in the app** ("a phase younger than N ms is not drawn"): two drawing places would hold two thresholds.
- **The graph reports it builds via its own event.** The wait belongs to the turn: the same graph, opened by an act with no run, is shown to nobody.

## Out of scope

- **Opening at a mid-run context boundary** — after `move_thread`. The step phase "Preparing the next step" runs there.
- **Starting the run before setup ends** — the open question in [[09a80ba9]].

## Order

Independent of [[1e154af5]]: without it the graph wait shows, with it the setup wait shows.

## Acceptance criteria

The performer proves:
1. **An opening-phase test of native run assembly** (`thread/run/assembly/openingPhase.test.ts`, `@runlith/effect-test`, `it.effect` with test clocks, no sleeping, over a real `ThreadLiveFeed`). While context holds work in `waitingOn` past grace, the run's live-feed view carries `phase: 'opening'` with that `waiting` and `since` of the work's start. Work shorter than grace publishes no `waiting`. The first `preparing` replaces `opening`.
2. **A `ThreadPhaseFeed` test** (`threads/list/phase.test.ts`): `opening` with `waiting` reaches `ThreadPhase`.
3. The `context.ts` wiring is not covered by test: checking "whether the port was called" is mock bookkeeping. The operator sees it.
4. No row-word tests (the minimal-test rule).

## What the operator checks

Not a task-closing condition. A child with `worktree: "new"`: the status says "Waiting for setup of …" and "Opening the graph of …" with seconds, then the usual turn follows.
