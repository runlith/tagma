---
id: 01a13d1d-cf8d-7804-a695-42f728361cbb
title: "Project pulse: the server gives, per project, the count of working threads and ones awaiting answer"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Pulse.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/feeds.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/attentionFeed.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/feeds.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/pulseFeed.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/summary.ts
---
The project strip ([[4e40cd91]]) and the project list show on every project how many threads work there and how many await the operator's answer. The client doesn't have those numbers for every project at once: "Attention" carries no working threads and gives a 200-row window (`ATTENTION_FEED_ROWS`), and the thread list exists only for the open project. A second derivation at the client is forbidden by rule [[51c66cb6]], so the server gives the numbers.

## Feed

- `threads.pulse` — a live feed of the server threads module (`server/src/threads/list/feeds.ts`, declared next to `ATTENTION_FEED` in `contract/wire/feeds.ts`), `callers: 'operator'`, empty entry.
- The first frame is `{type: 'all', projects: [{projectId, working, awaiting}]}`: projects with non-zero numbers.
- Then `{type: 'changed', projectId, working, awaiting}` whenever a project's numbers change; zero arrives too.
- When the server thread list declares `resync` (`threads/list/threadList.ts`), the feed recounts the numbers and gives `all` again.

## What counts

- `awaiting` — the project's threads where `attentionOf` (`threads/list/summary.ts`) answers `awaiting`. That's the same owner and function by which "Attention" puts a thread in "awaits answer": an open question to the operator, including a question with no run going, at a non-archived operator thread. So the strip's numbers and the "Attention" rows never diverge.
- `working` — the project's non-archived operator threads with a run going: the `life` of the row is `working` or `stalled`, and the thread isn't counted in `awaiting`.
- Plugin and outside-sender notifications of the project have none and don't enter the pulse; they stay in "Attention".
- The thread-list owner counts over `ThreadList.subscribeAttention`: the shared row stream and `resync` that `attentionChanges` for "Attention" is also built from. The finished `attentionChanges` holds only "Attention" rows and carries no working threads. One row change shifts that thread's contribution to its project's numbers, with no recount of every thread ([[2393aff1]]). The starting numbers are one narrow read of working threads and question-slotted threads over every project; idle threads with no question aren't read.

## App

`ProjectPulse` is an app-tier service in `apps/tagma/app/src/lib/features/projects/Pulse.svelte.ts`. It holds the feed through `Live.hold` and answers `of(projectId)`. The dock, tabs, full project list and the ⌃` switcher read it.

## How to check

- Implementer: a tier-budget integration test of the feed:
  - the starting frame matches the thread state;
  - a run started in project A gives `changed` with `working` one higher;
  - a question to the operator, including one with no run, moves `awaiting`, and `attentionOf` of the same thread answers `awaiting`;
  - the run's end returns the numbers;
  - `resync` gives a new `all`.
- Operator: the strip's numbers match the projects' thread lists and "Attention".
