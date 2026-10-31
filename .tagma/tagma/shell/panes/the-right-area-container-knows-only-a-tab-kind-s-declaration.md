---
id: 01a1111f-cb08-7b09-8866-b747a562a1a3
title: The right-area container knows only a tab kind's declaration about it
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/layer.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/PaneRegistry.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/SidePanes.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/TabLayouts.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/panes.ts
  - kind: file
    ref: apps/tagma/app/src/lib/shared/panes/pane.ts
---
A right-area tab is `{key, kind, id}` (plus an `agent` mark when an agent opened it). The container (`SidePanes`) and the layout store (`TabLayouts`) know only the kind's `PaneKind` declaration and never branch on kind: `view` lazily loads the component, `title` paints the label in the strip, `noun` names the thing in accessible names and refusals, `admits` decides whether a tab with such an id may stand with this holder (a thread never opens beside itself), `stands` — whether the thing still stands with this holder, `close` — the thing's owner takes tab closing upon itself and removes the tab once the thing is gone, `keep` keeps the tab mounted but hidden, `hold` — an invisible component that stands while the tab stands and holds what the tab will return to (a block tab holds the graph copy where the block lives: otherwise every return to another project's block tab would reopen its scope and read the whole copy tree anew), `portable` admits an agent tab onto another project's screen where that agent is shown (a browser page), `offer` — the "+" menu item, `moves` — "Open in …" takes the thing out of the right area, and its tab closes (a thread: the same thread never stands as both main and tab). The "Open in …" itself on the active tab is not a field of the tab kind: the link kind recognizes its own tab (`LinkKind.tab`), and the header opens that link's full place through `Opening`, so it is always the same as ⌘-clicking the link to that thing. A feature declares its kinds at its own place (`features/*/panes.ts`) and contributes them to the `Panes` point from its own layer; `PaneRegistry` indexes the point's current items. The panel module sits below features and loads no kind, otherwise every module importing the container would drag in all kinds through an import cycle. The contributions are app-tier members that join when the app scope starts, before any project-tier `TabLayouts` restores, so a restored tab always finds its kind, while a tab of an undeclared or inadmissible kind never opens (a refusal with reason `undeclared` or `inadmissible`) and is never restored.

`stands` and `close` ask the project's services, so `SidePanes` receives the shown project's layouts together with its resolver in one `attach`, performed by the mounted `RightArea`: a project's resolver exists only in that project's component tree. With no shown project there is neither layout nor closing, and no tab is removed past its owner. The container derives the shown layout's holder itself: the main slot (`seatMain`, placed by `ChatShell`) gives the project's thread or draft, otherwise a section (`showSection`). `stands` answers `true`, `false` or `null`: `false` — the thing is gone, the tab drops out of the shown layout and is swept from the stored one; `null` — the owner does not know yet (the set is not loaded, the thread is unread, or the read failed), and the tab stays — otherwise a server or app restart would wipe the layout. That is why `ThreadNames` answers "unknown" on a read failure, not "no thread".

A new place on the right is a new tab kind, never an overlay or its own aside: that keeps width, focus and per-holder memory shared.
