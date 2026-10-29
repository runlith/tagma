---
id: 01a13d1d-cf8d-7804-a695-42f8fba4f4d3
title: "Warm projects: the current and two recent ones hold their scope, and returning to them doesn't wait on the server"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/commands/Activity.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/places/State.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Panel.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/Sections.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/BoardState.svelte.ts
  - kind: file
    ref: packages/layer/src/App.ts
---
Returning to a recent project renders from memory and doesn't wait on the server. Right now leaving a project closes its scope in the service graph, and returning builds and re-subscribes everything from scratch (parent spec, "What happens now").

## Which projects are warm

- The current project and the two last ones the user entered in this window — from the recents of [[4e40cd91]], only from strip composition.
- Entering a fourth evicts the oldest. "Remove from strip" takes the warmth off too.
- A project not entered in this window is never warm: at launch the window opens no extra scopes and subscriptions.

## How it holds

- `WarmHolds.svelte` mounts in `Shell.svelte` outside every `{#key}` and renders `{#each warm as aim (key)} <WarmHold {aim} />` over the first three of `ProjectStrip.visited` — projects entered in this window, current first, the rest only while in strip composition. Here `aim` is the `GraphRung` source for the current project, and for the rest the project and the branch `Visits` remembers for that project, and `key` is `projectId:branch`, like the `GraphRung` key.
- `WarmHold` calls `App.hold(ProjectRung, {projectId})` on init, and under it `App.hold(GraphRung, {projectId, branch})`. A branch change inside a project changes the key: the old branch hold releases, and the graph scope `Visits.resume` points at is held.
- Destroying the component releases both holds, and the existing path closes the scope: `release` → `leaving` → `adopt`. The `Handoff` contract doesn't change. The only `onLeave` consumer is `Overlay`, which closes only non-`app`-level overlays (`Overlay.svelte.ts`, `closeRung`), and there are none in the app.
- A held scope keeps the `project` and `graph` tier service instances and the state they hold on live subscriptions: the thread list, presence, the worktree board, commands, terminals, checkout, the tree.
- Query-cache records live by their own `gcTime`, not by warmth. With no observer a record is collected after 5 minutes (the TanStack default: `runtime.ts` doesn't set it) or at once where `gcTime: 0` stands. The cache drops scope records on `closed` (`packages/query/src/repo.ts:58`), but warmth doesn't extend a record with no observer. So "from memory" is the state of services on live subscriptions, and reads through repo can still go to the server. The measurement will tell whether that must change.
- The thread feed doesn't hold. On return the shown thread takes its session off the `ThreadChats` shelf (`threads/thread/ThreadFeed.svelte.ts:44-51`): the feed is on screen at once, the server only sends the tail past `since`. The shelf doesn't take feeds heavier than 8 MB; what to do with them is the measurement's call ([[2516a131]]).
- On return `{#key standing}` remounts the page, but the components get the same instances: `App.ensureUnder` finds the open place. The list's first frame is from memory.

## Project state and window acts

A held but non-current project lives next to someone else's address and someone else's window registries. So a `project`- or `graph`-tier service has two parts:

- **Project state** lives while the project is warm.
- **Window acts** — writing to window registries, following the window address — go only while the project is current.

Otherwise:

- `features/plugins/Sections.svelte.ts` (`project` tier, eager) registers plugin sections in the window `surfaceRegistry` and acts in `PluginActions`, and takes them off only when the scope closes. With one plugin in two projects the repeat registration throws `RegistryClash` (`workspace/surface.ts`, `register`), and the rail would show the background project's sections.
- `features/worktrees/BoardState.svelte.ts` and `features/executions/places/State.svelte.ts` read the `Router`. `TerminalPanel.aimed` follows `Worktrees.aimed` (`executions/terminal/Panel.svelte.ts:23-25`), with `TerminalPlaces` effects on it (`places/State.svelte.ts:91-98`). `features/executions/commands/Activity.svelte.ts:369` reads `workspace.contextProject`. In the background project all that would follow someone else's address.

Mechanism:

- `ProjectFocus` is a project-tier service in `features/projects/`, one subject: whether this project is current in the window. It compares the window's `ProjectRung.Source()` with its own `ProjectRung.Current`.
- `Sections` publishes while `ProjectFocus` says "current", through `PluginActions.show` — one publication of sections and acts per window: a new one first takes the standing one off, and taking off an already-replaced one does nothing. Two projects' effects run in an order Svelte doesn't guarantee: moving between two warm projects, the entering effect can overtake the leaving one, and without one publication the repeat registration would throw `RegistryClash`.
- Services reading the address take their target from their own scope (`ProjectRung.Current`, `GraphRung.Current`), and do what must follow the window address only while the project is current.
- Warm projects are several, so what is shared for the window doesn't live as a copy in each: the operator's preferences (`Favorites`, `ModelDefaults`) are `app` tier, and a `SettingsRepo.write` answer carries its project, with the reader taking it only for its own (`writtenCatalog`). It writes the terminal layout `TerminalPlaces` with its own mutation (`write.in(scope)`), so a background project's write doesn't push out the window's last record. A deferred act that ends by writing the window address (`TerminalPlaces.reveal` → `readdress`) checks `ProjectFocus` where it's written.
- The implementer walks every `project`- and `graph`-tier service on those two marks — writes to an app-tier or module registry, reads `Router`, `page` or `Workspace.active*` — and lists what's found in the task. The ones named above were found on 2026-10-15.

## Cost

- A held scope keeps every `project`- and `graph`-tier service and their subscriptions. Their size grows with the count of threads, worktrees and project files. The implementer measures the memory and subscription count of a warm project on the operator's largest project and reports it as a sample ([[fe83acfa]]). If warmth proves dear on a weak machine, the knob is the warm count.
- Background traffic is the three projects' subscription events.
- Not sped up: first entry to a project, page remounting, and long-feed rendering. That's the [[6d2aaae1]] idea, decided by the measurement.

## How to check

- Implementer:
  - an app svelte test: A → B → A — on return no new `threads.subscribe` call, and `ThreadList` is the same instance. Entering a fourth project ends the oldest one's subscriptions. A branch change in a warm project releases the old graph scope.
  - `ProjectFocus`: with one plugin in two projects, an A → B move doesn't throw `RegistryClash`, and the rail shows only B's sections.
  - Measurement ([[2516a131]]): the "after" report — returns to warm projects log with `warm: true` and no list wait; stage medians against the "before" report.
- Operator: under usual load, there-and-back moves between two projects are instant.
