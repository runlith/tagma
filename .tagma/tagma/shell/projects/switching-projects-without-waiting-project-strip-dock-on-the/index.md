---
id: 01a13d1d-cf8d-7804-a695-42f45c264599
title: "Switching projects without waiting: project strip (dock on the left or tabs on top), warm projects and keyboard moves"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Shell.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/TopBar.svelte
  - kind: file
    ref: apps/tagma/app/src/routes/[project]/+layout.svelte
---
A desktop user works in several projects at once and switches between them as often as between browser tabs. Right now the move is the header's project menu, a pick, and a wait; under server load the wait lasts seconds. Goal: projects the user works in switch with one press and no server wait, and before the move it's visible where agents work and where they await answers.

## What happens now

1. The only entry to another project in desktop is the header menu (`app/chrome/TopBar.svelte`, `switchProject`): a `goto` to the project address. ⌘K has no project move.
2. The `ProjectRung` source changes, and the service graph closes the old project's scope (`packages/layer/src/App.ts`, `leaving` and `adopt`). Every `project` and `graph` tier service ends with its live subscriptions, and the query cache drops the closed scope's records (`packages/query/src/repo.ts:58`). What remains of the old project are app-tier things: the last place (`Visits`) and the shelf of detached feed sessions (`ThreadChats`: up to 8 sessions and 32 MB per project).
3. The new project's scope opens, and the graph builds every tier service at once (`Graph.data` is `eager`). Every service re-subscribes: the thread list (`threads.subscribe` starts from a full list window), presence, the worktree board, commands, plugin views and sections, terminals, and under `GraphRung` — checkout, holders, the tree. The page mounts from scratch: `{#key standing}` in `routes/[project]/+layout.svelte`, `{#key projectKey}` and `{#key frameKey}` in `app/chrome/Shell.svelte`.
4. The thread the user stood on in that project reopens. If its session lies on the shelf, the feed shows at once and reads up from the held position (`thread.subscribe` with `since`, `threads/thread/ThreadFeed.svelte.ts:44-51`). Otherwise the server assembles a full snapshot. The shelf doesn't take feeds heavier than 8 MB (`DetachedSessions.ts:33`), so the longest feeds always assemble from scratch.

Not measured: how the seconds split between waiting on the server, assembling services and rendering the page. That's the first work: [[2516a131]].

## What the user gets

- A **project strip** — a dock left of the rail or tabs above the header, the user's choice, with one behavior: one click, ⌘1–9, ⌃` to recents — [[4e40cd91]].
- **Pulse** on every strip project: how many agents work and how many await answers — [[28361cbb]].
- **Warm projects**: returning to recent projects renders from memory, with no server wait — [[fba4f4d3]].
- **Another project's thread in the side panel** — answer the agent without leaving the current project: [[7d7a8fed]].
- **A project in a separate window** — for the second monitor: [[297e48f0]].

## Shared decisions

- **One strip model, two looks.** Composition, order, recents and the current project are one model; the setting picks only whether the dock or the tab row draws it. Closing a tab and removing a project from the dock is one act. Otherwise the two looks would become two products with different logic.
- **Moving to a project goes to the last place in it** (`Visits.resume`), like a browser tab returns its page. That's true for the strip, keyboard, ⌘K and the project menu. The menu's current rule — "same section if portable" — goes away.
- **Warm are the current project and the two last ones the user entered in this window.** The user doesn't manage memory. Three covers there-and-back moves and a third project. A project not entered in this window is never warm, and at launch the window opens no extra scopes.
- **Warmth cost grows with the project, not the machine.** A held scope keeps every `project` and `graph` tier service and their subscriptions, and their size grows with the count of threads, worktrees and files. So [[fba4f4d3]] measures it on the operator's largest project and reports it as a sample; three is the knob if warmth proves dear on a weak machine ([[fe83acfa]]).
- **A held project's service has two parts.** Project state — list, board, subscriptions — lives while the project is warm. Window acts — writing to the window registries and following the window address — go only while the project is current. Otherwise two projects would write to one window registry, and a background project's service would follow someone else's address ([[fba4f4d3]]).
- **A warm project doesn't keep the thread feed live.** The detached-session shelf already returns the feed at once and reads the tail up from the position. A live feed in the background would cost the client handling every frame of working threads in every warm project. The gap — feeds heavier than 8 MB — is the measurement's call.
- **No disk cache.** It would only speed the first opening after launch, and in return would need tracking staleness and the shape of stored data.
- **A slow server doesn't hide behind a client cache.** The stage the measurement shows dear is sped up by its owner ([[2393aff1]]).
- **Keyboard is desktop on macOS only.** In the browser ⌘1–9 is taken by the browser itself.

  | Chord | Does |
  |---|---|
  | ⌘1…⌘8 | the project at that strip place |
  | ⌘9 | the strip's last project |
  | ⌃`, ⌃⇧` | recent projects: hold ⌃ and page, release to move |

  - ⌃Tab stays with terminal and file tabs: it's already taken by `previous-recent-tab` in `executions/terminal/Keymap.ts` and `checkout/files/keys.ts`. ⌃` is free on macOS and rhymes with ⌘`, which macOS pages app windows with.
  - On Windows and Linux Ctrl+digits (files), Alt+digits (terminal) and Ctrl+` (terminal) already have owners, so projects have no chords there: the move is through the strip and Ctrl+K.
  - ⌘W doesn't change: closing a project is the tab × or the strip menu item.

## Order

1. [[2516a131]] — first, to record the "before". In parallel — [[4e40cd91]] and [[28361cbb]].
2. [[fba4f4d3]] — after the strip: warmth takes from its recents.
3. [[7d7a8fed]] — after warmth: it holds the thread's project with the same `App.hold` and leans on the same service split.
4. [[297e48f0]] — independently, at any time.
5. The post-warmth measurement decides the [[6d2aaae1]], [[88091580]] and [[07e21d1e]] ideas.

## Acceptance

- Implementer — each child spec's acceptance.
- Operator — under their usual load switches between three projects by dock and tabs, ⌘1–9 and ⌃`. The measurement shows returns to warm projects don't wait on the server.
