---
id: 01a13d1d-cf8d-7804-a695-42f52516a131
title: "Project-switch measurement: where time goes from selection to the thread list and feed"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/threadOpenRecord.ts
---
Unknown: where the seconds of switching under load go — waiting on the server, assembling the service graph, or rendering the page. The answer decides whether warm projects are enough and which ideas from [[6d2aaae1]], [[88091580]] to take up. The measurement doesn't depend on the other works of the family and lands first, to record the "before".

## Owner and start of counting

- The record is written by `apps/tagma/app/src/lib/features/projects/switchRecord.ts` after the `features/threads/threadOpenRecord.ts` model: `performance.measure` named `tagma.project-switch`, the same stored-record limit, the same counter (`tagma.project-switch.tally`).
- Counting starts in `beforeNavigate` of SvelteKit, when the `project` param changes. That's one place for every entry: menu, ⌘K, link, back/forward, "Attention", later the strip, keyboard and ⌘K. The listener mounts in `Shell.svelte`.
- `from` is the SvelteKit navigation type (`link`, `popstate`, `goto`) plus the entry mark, if the one who started the move set it. `ShellOps` sets the mark: `openThread` — `thread`; the coming `openProject` — its callers pass `strip`, `keys`, `palette`, `menu`.
- A move preempted by a new one before finishing is not a record but a counter tick `declined.superseded` in the tally, like `declined.reselect` in `tagma.thread-open`.

## What the record holds

- `warm` — whether the project's open scope was found: a narrow read `MountedApp.hasScope(ProjectRung, input)`, with no scope opened and no app diagnostic report built.
- Stage marks in ms from the shared start: `navigationMs` — `afterNavigate`, including SvelteKit `load`; `scopeMs` — `Handoff.ready` of the project; `listMs` — the first applied `ThreadList` frame or the already-ready list; `threadMs` — the shown thread's `tagma.thread-open` record by `threadId`. Stages can overlap: these are arrival points, not summed.
- `thread` holds the opening's source record, including `replayed` and `entries` at chat; harness has neither. In a move with no thread picked, `thread` and `threadMs` are `null`.
- `frameMs` and `totalMs` of a finished move are the next `requestAnimationFrame` after navigation, scope readiness, the list, and the thread record. If `tagma.thread-open` ended on its deadline with no frame, the measurement at once saves the unfinished move: `frameMs: null`, unreached stages `null`, `unfinished` in the tally grows. The next navigation doesn't turn it into `superseded`; a late frame creates no second record.

The record reads like `tagma.thread-open`: `performance.getEntriesByName` in the renderer through devtools or the chrome-devtools MCP. The measurement has no interface.

## Server

The server side is telemetry spans ([[2a74de70]]). Opening a `thread.subscribe` already has a span: `ThreadFeeds.open` with `openPath` (`server/src/threads/list/feeds.ts:79`). The first frame of `threads.subscribe` has none (`:43-52`): the feed owner adds `ThreadFeeds.openList` after the same model.

## What lands

- The landed measurement and span.
- The "before" report under the operator's usual load: stage medians of finished moves and the share of finished chat moves whose feed came off the shelf (`replayed: false`), with the record count of such feeds. Unfinished moves and refusals count separately, so the slowest part of the sample doesn't vanish from the report. It's one sample on one machine, and the report says so ([[fe83acfa]]).
- For every stage that proves dominant — a #task at its owner: the feed server, the service graph, page rendering. Those tasks take up the ideas and the shelf gap for feeds heavier than 8 MB.

The "after" report for warm projects is the acceptance of [[fba4f4d3]].

## How to check

- Implementer: an app svelte test — an A → B move gives one record with stages in order and a true `warm`; a move preempted by a third grows `declined.superseded` and gives no record.
- Operator: reads the report.
