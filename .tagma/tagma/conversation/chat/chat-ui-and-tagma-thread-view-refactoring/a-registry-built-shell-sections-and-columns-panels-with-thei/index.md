---
id: 01a118f1-5f59-7eb8-856a-a0e730b488ab
title: "A registry-built shell: sections and columns, panels with their own geometry, ShellOps, one slot writer"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Columns.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/panes.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/address.ts
  - kind: file
    ref: apps/tagma/app/src/lib/shared/reading/Panes.svelte.ts
---
**Outcome.** The app shell knows by name neither sections, nor their columns, nor side-panel kinds, nor their sizes: features declare them, and the shell assembles declarations into registries. A thread, panel or section opens with one typed operation, including from an entry renderer. Each slot has one writer of "which thread is shown".

**What is closed now.**
- Sections:
  - the `SURFACES` constant and the `SEGMENT` map (`features/workspace/address.ts:11-29`);
  - `surfaceOf` (`:151-154`);
  - `Columns.of`, which knows that `chat` has the agents column while `outline`/`graph` have the knowledge column (`app/chrome/Columns.svelte.ts:55-58`);
  - visit fields per section (`features/workspace/Visits.svelte.ts`).

  The `stands` layout branch (`routes/[project]/+layout.svelte:15-23`) already reads data and stays.
- Panel kinds are declared by the feature (`calls/pane.ts`), and the central `PANE_KINDS` list assembles them (`app/panes/kinds.ts:4`). Size is a name from the closed `PaneName` union, which also names each column (`shared/reading/Panes.svelte.ts:7-30`).
- `ScreenThreads` is typed on `HarnessHost` (`OnScreen.svelte.ts:4-11`). Navigation is href strings (`action.ts:11`). The kit's `openThread` hook leads to the slot's local navigation.

**`SurfaceRegistry`.**
- A feature declares a section: `surface`, route segment (empty at the project root — the `outline` section), label, icon, nav place, `stands`, the section's column (if any) and what a visit remembers.
- The section route stays a SvelteKit file. `surfaceOf` matches the route id against declaration segments, including the root.
- Navigation, `Columns`, `Visits` and layout read the registry and never branch on a section name.
- Direct URL and restore go through the same route.
- The "declaration ↔ route" match is checked against the route manifest SvelteKit assembles (`import.meta.glob` over `routes/[project]/*`), in a separate test with no test app.
- A section with no route file of its own (a plugin section) registers on the fly: `register` returns a disposer, the `plugin` umbrella with `nested` owns the `/[project]/p/[plugin]/[view]` file, `of(routeId, params)` finds the section by params ([[f9c4cd67|the plugin-section-and-panel note]]).

**Columns.** Each column (`sidebar`, `threads`, `settings`, `files`, `checkout`, `diff`, `log`, `terminals`) declares its `SeamPane` geometry at its owner. A section refers to the column from its declaration. The `PaneName` union and the `PANES` table go away.

**Panel kinds.**
- `PaneKind` carries its own `SeamPane` instead of a `PaneName` name. Kinds assemble from feature declarations.
- The kept-size key is declared by the kind or the column. Current keys (`beside`, `call`, column names) never change, so nothing migrates.
- Kind descriptions assemble at load, before layout restore, and their views load lazily. A restored panel always finds its kind.

**`ShellOps`.**

| Operation | What it does |
|---|---|
| `openThread({projectId, threadId}, target)` | `target`: `main` or `beside` |
| `openPane(kind, id)` | opens the side panel |
| `revealSurface(surface)` | shows the section |

- `main` opens another project's thread in its project, `beside` in the current one's side panel, under the home project ([[7d7a8fed|another project's thread in the panel]]). A thread's existence without a project is not checked.
- The palette, menu, list row and entry renderers call `ShellOps`. The app fills the kit's navigation port (`openThread`) through `ShellOps`.
- `beside` keeps the current policy: a thread already shown in a column or panel opens there, not duplicated (`app/panes/SidePanes.svelte.ts:135-159`).
- The mobile shell is its own adapter: `beside` opens a thread in the main slot with a return (`app/mobile/Screen.svelte.ts:30-32`).
- Every operation is an `Effect`. An unavailable target (kind undeclared, thread deleted) is its `Schema.TaggedError` with a reason, not a silent navigation.
- The `window` target will add the plugin spec with a desktop adapter.

**One "slot → thread" writer.**

| Slot | Writer | How a thread gets there |
|---|---|---|
| main column | route | `ShellOps.openThread(…, 'main')` writes the route |
| side panel | `SidePanes`, the `layout.panes[].id` field (`SidePanes.svelte.ts:57,197-208`) | `openThread(…, 'beside')` and `openPane` change it |

`ThreadSlot` reads the writer and never writes back: the `SidePane.svelte:43-55` write-back goes away. `seats` stays the registry of mounted slots. `ThreadOnScreen` types on `ThreadSlot` and stays a reader: what is shown, whose focus, `shown` for the read mark.

**How to check (performer).**
- A test feature declares a section with a column and a panel kind with its own geometry:
  - the section shows in navigation;
  - its column opens;
  - the manifest test sees its route;
  - the panel opens with `openPane` in its own sizes and restores after reload.

  Shell files unedited.
- `openThread(…, 'beside')` on desktop opens a panel or expands the already-shown thread. On the mobile shell it opens the main slot with a return.
- A route change during a thread open never leaves the slot on the old thread (`SidePanes` tests).
