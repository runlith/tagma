---
id: 01a13d1d-cf8d-7804-a695-42f64e40cd91
title: "Project strip: dock on the left or tabs on top over one model, ⌘1–9, ⌃` to recents, and projects in ⌘K"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/AppMenu.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NavigationRail.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/palette/query.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/ShellOps.ts
---
The project strip replaces the menu as the daily way to move to another project. It has one model and two looks — a dock on the left or a tab row on top; the user picks the look, behavior is the same for both.

## Model

- **Composition** — projects the user holds in the strip, in their order. Any project the user entered lands in the strip: from the menu, ⌘K, by link, from "Attention", with back/forward arrows. A project is appended, unless it's already there.
- **Removing** a project is the × on the tab or the "Remove from strip" context-menu item. The project stays registered: the project menu and ⌘K open it. A removed current project stays on screen; it returns to the strip only when the user enters it again.
- **Order** changes by dragging, in both looks.
- **Recents** — the order of entering projects in this window, current first. A window starts with the order last saved and saves its own on every entry: a new window and the next launch continue from it. ⌃` works over recents; [[fba4f4d3]] takes warm ones from them — only the ones entered in this window.
- **First launch** of the strip: projects that `Visits` remembers a place for, in registry order, plus the current one.
- A project deleted from the registry leaves the strip on the next registry read.
- **The strip shows** when at least two projects besides global are registered. A user with one repository never sees it. The mobile shell doesn't change.
- Composition, order, saved recents and look are stored on the device, in `PlatformStorage` (`tagma.strip`), like the theme ([[54780672|theme decision]]). A write re-reads the document and changes only its own part, like `Visits.remember`, so a second window doesn't lose someone else's edit. Live sync between windows is in [[297e48f0]].

## Dock

- The dock is the top group of the `NavigationRail` itself, not its own column: project tiles on top, below the divider the current project's section icons, at the bottom settings and collapse. Two narrow side-by-side columns left both bottoms empty, and section icons belong to the current project and stand right under its tile.
- Project tints are the `--project-1…8` tokens in `app.css`; the tint is a pure function of the project id, with no redistribution on collision, the way `handHues` does. Then a project's color doesn't depend on strip composition; two projects with one tint differ by letters.
- Tiles are calm, signals loud: a tile doesn't argue with content, and the pulse reads at once. The approved mockup is the "Project dock" page (option D), its sizes and tokens below.
- **Tile** 32 × 32, `rounded-lg`, two letters `text-small font-semibold` in the project color on a fill of the same color: 17% in the dark theme, 12% in the light, inner border 24% / 20%. On hover the fill is 27% / 19% with an 8 px stripe on the left, semi-transparent.
- **Current project** is the only filled tile: project-color background, `--primary-foreground` letters, `shadow-raised`, a 3 × 20 `--foreground` stripe at the dock's left edge. No ring around the tile.
- **Pulse** ([[28361cbb]]), look D:
  - working — a thin `--status-in-work` arc around the tile (4 px offset, 1.5 px thick, pale track), one turn per 4.5 s, and a capsule with the number bottom-right: height 16, min width 16, padding 4, `rounded-full`, `--status-in-work` background, `--primary-foreground` digits centered monospaced, over 99 is "99+";
  - awaiting answer — a 10 px `--status-open` dot top-right with a pulsing halo;
  - the capsule and dot stand on a cutout of the dock color — `0 0 0 2px var(--chrome)` shadow, not a `border`: that keeps the capsule round at any number and cuts the arc under it.
- The hover hint: the project name and its chord.
- Context menu: "Remove from strip", "Show as tabs", "Open in new window" ([[297e48f0]]).
- More tiles than fit: only the project group scrolls; sections and settings stay put. The edge past which tiles hide fades; the current tile scrolls itself into view. If working or answer-awaiting agents sit past the edge, the edge carries a mark: an arrow, the working sum, and a blue waiting dot; a click scrolls to the first such project.
- The dock holds no full project list: the project switcher in the header holds it, with New project. So one look has one full list.

## Tabs

- A row of `--topbar` height above `TopBar`. The macOS window-button indent (`w-16` in `TopBar.svelte`) moves to this row, so `trafficLightPosition` in `desktop/src/main.ts` doesn't change. The row is a drag region, tabs are `no-drag-region`.
- A tab: the project-tint square, the name, the pulse, the × on the current and hovered tab. The pulse in the tab, in the full project list and in the ⌃` switcher is the same capsule with the number and the same dot as the dock, with no arc.
- At the row's end "+" opens the full project list with the pulse and New project.
- Tabs squeeze to a minimum width, then the row scrolls, and the current tab is always visible.
- The context menu is the tile's, with "Show as dock".
- The project switcher leaves the header: the name stands on the tab, the full list sits behind "+". The back/forward arrows and the worktree switcher stay in the header.

## Look

The look is picked in the app menu as the "Projects: Dock | Tabs" segment next to Theme, and in the strip's context menu; the segment shows when the strip shows. The default look is the dock.

## Keyboard

Desktop on macOS only; chords are in the parent spec.

- ⌘1…⌘8 — the project at that strip place, ⌘9 — the last one.
- ⌃`: hold ⌃ and press ` — selection walks the recents, ⌃⇧` — back. The move happens when ⌃ is released, always; Esc cancels. A quick press and release goes to the previous project. The switcher — strip projects in recents order, with tint, name and pulse — appears if ⌃ is held longer than 120 ms after the first `: that way a fast move doesn't flash it.
- The key is caught by `code` — `Backquote` or `IntlBackslash` — not by the `key` symbol: the symbol depends on layout (in Russian that place isn't `), and on ISO Mac keyboards the key left of 1 arrives as `IntlBackslash`. So ⌃ plus the key left of 1 works on any layout and any keyboard.
- The switcher is a kit-overlay ([[de36c9fd]]): it doesn't open over the palette and closes it.

## ⌘K

The palette gets a Projects group. A non-empty query matches registered project names, Enter opens the project. Works in the browser too.

## Mechanism

- The `apps/tagma/app/src/lib/features/projects/` feature:
  - `Strip.svelte.ts` — the app-tier `ProjectStrip` service, one subject for the strip: composition, order, recents, look, visibility. It reads `Workspace` (the registry and current project), `Visits` (first launch) and `Platform` (storage). It writes composition and recents itself, watching the current project: every entry into a project, wherever it came from, passes through it, and they have no second writer.
  - `Dock.svelte` and `TabRow.svelte` — two looks over `ProjectStrip` and `ProjectPulse`, with shared pieces: a project tile or label, the pulse, the context menu.
  - `Switcher.svelte` and `keys.ts` — a pure function "key press → strip command", after the `checkout/files/keys.ts` model; the listener mounts in `Shell.svelte` next to `DictationKeys` and only in desktop on macOS.
- `ShellOps.openProject(projectId, entry)` — a new operation of the `ShellPort` port (`features/workspace/ShellOps.ts`), on each of its three implementations; `entry` (`strip`, `keys`, `palette`, `menu`) is the entry mark the operation sets for the [[2516a131]] measurement before the route change:
  - `DesktopShell` and the mobile shell go to the project's `Visits.resume`;
  - `MainWindowShell` of a plugin window opens the main window at that address, like its other operations.

  Before the route change the operation awaits the two `App.prepare` rungs the project move shifts — `ProjectRung` and `GraphRung` ([[47906852]]). The strip, keyboard, palette and project menu call it; `TopBar.switchProject` goes into it. `ProjectStrip`, not the operation, adds the project to the strip.
- Hovering a tile, tab or list item longer than 150 ms, and selecting in the ⌃` switcher, calls the same `App.prepare` ahead, so chunks are already lying there by the click. One app-tier `ProjectPrefetch` service prepares both project rungs (`features/projects/Prefetch.ts`): `openProject` awaits it, so entry and hover prepare the same. Prefetch doesn't touch data: a held scope builds the whole rung at once (`Graph.data` is `eager`), and hovering would open dozens of subscriptions nobody asked for.
- `Shell.svelte` draws `TabRow` above `TopBar` or passes `Dock` to `NavigationRail` as a `projects` snippet — by the look and visibility from `ProjectStrip`. The rail doesn't import the projects feature.
- Palette: `projects` first in `GROUPS` (`features/palette/query.ts`), rows from `Workspace.projects`, opening through `ShellOps.openProject`. An empty query shows projects only under their own chip.
- The ⌃` switcher is an overlay `as: 'launcher'` (`Switcher` in `features/projects/Cycle.svelte.ts`): it takes no focus, so releasing ⌃ reaches the window listener. Its policy doesn't get along with the palette, and the listener closes the palette on the first `.

## How to check

- Implementer:
  - `ProjectStrip`: entering a project adds it once and puts it first in recents; "remove" takes it off composition, and the project doesn't return until the user enters it again; one deleted from the registry leaves; state restores from storage; a write doesn't lose an edit another window made between read and write.
  - `keys.ts`: the chord table on macOS; on Windows and Linux there are no project chords; the ⌃` move happens on ⌃ release.
  - Palette: the query finds the project, Enter moves.
  - `openProject` goes to the project's last place for every port implementation.
- Operator: both looks in desktop and browser, light and dark themes; ⌘1–9; ⌃` short and held; dragging.
