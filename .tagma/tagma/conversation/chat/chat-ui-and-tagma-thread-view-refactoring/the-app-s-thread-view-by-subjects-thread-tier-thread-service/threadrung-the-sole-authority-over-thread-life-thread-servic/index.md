---
id: 01a118f1-5f59-7eb8-856a-a0e4e5e1e307
title: "ThreadRung — the sole authority over thread life: thread services, ThreadSlot and ThreadBirth instead of HarnessHost"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/threads/birth
  - kind: dir
    ref: apps/tagma/app/src/lib/features/threads/thread
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThreadSlot.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/ThreadRung.ts
---
**Outcome.** In the app, a thread gains owners bound to one thread and living in one existing mechanism — the layer's thread tier. The screen slot picks which thread to show and holds its own view state. A new thread's birth is run by a separate owner. `HarnessHost` (`View.svelte.ts`, 1181 lines without imports) splits across these owners and goes away.

**One authority over thread life — `ThreadRung`.** `features/threads/Rung.ts:7-12` already defines the `thread` rung under the project. The layer counts holders and closes the scope when the last one leaves and the scope was not picked by the rung's source (`packages/layer/src/App.ts:280-297`). Now the `ThreadRungSource` source picks the main column's thread (`screen.page`), while `native/Conversation.svelte:512` already holds the rung locally through `<Held>`. But the thread's fold and services are built by the slot's `HarnessHost` past it (`app/panes/SidePane.svelte:26`).

Goal:
- The rung is managed by holders entirely. Its source is explicitly empty (`ThreadRung.of(() => undefined)`): the ladder demands a source for every rung (`App.ts:247-253,386-390,436-448`), and slots pick the threads. The `ThreadRungSource` from `screen.page` goes away.
- Every slot showing a thread holds that thread's `ThreadRung` through a `ThreadLease` (`MountedApp.hold`): the slot changes the lease on thread change and releases it on close. Components needing a thread service outside a slot (pages button, changes) hold the same rung through `Held` with the thread's key. A panel and a column of one thread hold one scope.
- `ThreadFeed` is a `tier: 'thread'` service. It owns the thread's `ThreadSession` ([[eb9c2129]]).
  - On scope open it takes the detached state from `DetachedSessions` and does `attach`.
  - On scope close the finalizer first does `detach` and shelves the state, then closes the session scope. Closing the rung waits for this finalizer. So a new `hold` of the same thread finds the state on the shelf instead of racing a still-open session.
  - No other counters: the session keeps no refcount, the shelf only stores data.
- Thread services are `tier: 'thread'`, lazy, like `ThreadPages`, `OpenFile`, `ContextPanelState`, `ThreadChanges`. Built on first touch in this scope. An observer needing only the feed never pays for the rest.

| Service | What it takes from `View.svelte.ts` |
|---|---|
| `ThreadSettings` | model, account, switches, settings write (`:320-419,731-804,1186-1238`) |
| `ThreadAuthority` | thread mode (from the producer registry) and delegation (`:453-553`); its chip contribution in the composer |
| `ThreadCompaction` | compaction options, compact, refusal (`:844-938`) |
| `ThreadRecap` | `:831-842` |
| `ThreadInstructions` | `:940-965` |
| `ThreadComposition` | composition and its refusal |
| `ThreadPlace` | the thread's recorded place (part of `:1038-1067`) |
| `ThreadContext` | product enrichment of context: model metadata, labels, composition attribution over the kit's arithmetic (`:421-450`) |

Each service's dependencies are positional ([[c2f04d22]]).

- **Settings writes serialize per thread.** The next write leaves after the previous one's answer, intermediate intents fold into the last. The server order matches the intent order. Write holds are per thread, not per draft key (`:293-318`).
- **An answer after `dispose`** of the service publishes nothing. An answer arriving for this same thread applies: the service never changes threads, so it never has a foreign answer.

**Existing thread services move to the same rung.**
- `ThreadPages` (`features/pages/ThreadPages.svelte.ts`) now receives the thread command from `PagesButton`, which assembles it by walking the list (`features/pages/team.ts:9-25`). The command reads from the tree's parent index ([[13bda205]]), and the thread scope showing it holds the service.
- `ContextPanelState`, `OpenFile`, `ThreadChanges` stay thread-tier services. Now they also build for a thread in the panel. It is verified that `eager: true` on `ThreadChanges` costs nothing extra on every held thread; when it does, the service goes lazy.
- `PendingTurns` ([[eb9c2129]]) is created by composition next to the project connection, not in thread scope: started turns survive slot and scope closing.

**`ThreadSlot` — what `HarnessHost` would be without the domain.** Slots are the main column, side panel, mobile shell.

The slot holds:
- the shown thread's `ThreadRung` lease or `ThreadBirth`;
- this holder's `TurnCommands`;
- the draft;
- `PromptHistory`;
- feed memory;
- focus.

Drafts:
- a born thread's key, as now, `thread:<id>` (`View.svelte.ts:1030-1032`), so a column and a panel of one thread write into one draft;
- a new thread's key is each slot's own.

The thread is set to the slot by the slot's single writer ([[30b488ab]]). The slot reads it and never writes back. Now the panel writes both ways: `host.activeId → panes.settle` and `pane.id → host.activateRoute` (`SidePane.svelte:43-55`).

**`ThreadBirth` — a new thread in the slot.**
- Agent type, the new thread's place (worktree choice by the draft, part of `:1038-1048`), `ensureChat`/`launch`, births (`:694-715,1069-1109`).
- The mode picked before birth (`:453-473,529-535,1074-1081`). The mode chip on a new thread reads the modes the agent type declares, and `ThreadBirth` holds the pick. The pick leaves with the birth.
- `ThreadBirth` hands the accepted first turn to `PendingTurns` before async birth, load and send. So closing the slot during birth never loses the turn.
- Fills the birth port of `TurnCommands` and carries out the first Send's outcomes from [[eb9c2129]]: deletion only on pre-send failure.
- After birth it asks the slot's writer to show the new thread, but only while the slot still shows this birth. A birth finishing after the reader left leaves the thread in the list and never touches the slot.

**Operations and connection.**
- `HarnessTransport` (`ChatPort.ts`) no longer inherits the kit transport. The ~18 operations it forwards (`:76-178`) move to their services over `ThreadsRepo`.
- `orClosed` with a bare `Error` (`:180-184`) becomes a typed refusal.
- `ThreadConnection` and `THREAD_PORT` leave `wire/Live.ts` (`:480-566`) for the threads feature file. They fill the kit's `ChatConnection` port ([[eb9c2129]]) with the producer types RPC already decoded.

**Effect.**
- Thread-service work is `Effect` programs: commands, reads, subscriptions, waits. Their failures are the owner's `Schema.TaggedError`s.
- Every layer thread scope gets its own Effect `Scope` at one bridge point. This is the same device by which `wire/Live.ts:586-590` joins `LiveConnection` to the app's life: the scope forks from the app scope when the rung opens. A rung in `defer` returns its closing Promise, and the layer's `Scope.close` awaits finalizers that returned Promises (`packages/layer/src/Scope.ts:111-117`). Service fibers interrupt before the rung counts as closed. No second bridge exists.
- The scope runner is `FiberSet.makeRuntime` in this scope. A Svelte handler starts a service's `Effect` through it, and this is the only edge where `Effect` starts from UI. Scope closing interrupts everything the runner started.
- Readable state is the service's `$state` fields. Only its fiber writes them.
- The per-thread serialized settings write is one fiber-writer per thread over a queue holding only the last intent. The thread mode is switched by `ThreadAuthority` with the mode owner's operation ([[bb429da3]]).
- Time is Effect `Clock`. The `now`/`frame`/`timer` clocks leave `HarnessHostOptions` (`View.svelte.ts:110-118`). `ThreadOpenWatch` measures through `Clock`, and tests feed `TestClock` instead of indexing the constructor's positions (`app/testing.ts:96-100`).
- The app's DI stays `@runlith/layer`: this spec never moves the app composition to Effect `Layer`. That is a separate rebuild of the whole app, not the chat.

**How to check (performer).**
- `View` tests split across services.
- Two settings writes in a row reach the server in intent order. Switching slots during a write never writes into the new thread.
- Explicit holds work with the rung's source empty; the last `release` closes the scope.
- A column and a panel of one thread are one scope, one subscription, one draft. Closing the panel never touches the column. Closing the last holder shelves the session, and returning does resume.
- A screenless thread scope never marks the outcome as read.
- Birth: the turn shows at once. A pre-send failure deletes the thread and returns the draft. Refusal and break never delete the thread. A birth after the reader left never steals the slot.
