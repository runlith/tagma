---
id: 01a10891-853e-7f52-89f5-9e2954780672
title: 36 px header with project, search, “Attention” and menu; permanent five-section rail; thread title with a one-button team
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NavigationRail.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/TopBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Header.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/TeamStrip.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/address.ts
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
---
Top of the window: a 36 px header holding only the permanent. The rail is always the same. A thread starts with its title, the team in it is a single button, and there is no third strip.

## Header

`lib/app/chrome/TopBar.svelte`, height `--topbar: 2.25rem`. The header is a drag region, and every control in it is a `no-drag-region`. Controls are 28 high.

**Left**
- Window buttons on macOS: desktop, `pl-20` indent as now.
- Project switcher: projects menu, storage icon, New project.
- Worktree and branch switcher — `WorktreeSwitcher`, as now.

**Center.** A `Find or ask…` field-button with `⌘K`. It opens the palette ([[0ed5d929]]). About 420 px wide; on a narrow window the field collapses to an icon.

**Right**
- The “Attention” button — built by [[8f3cc5fd]]. Until it exists, the spot stays empty.
- App menu button — an icon with no avatar: Tagma has no user account.

**App menu** — a new component in `lib/app/chrome`:
- `Theme`: System / Light / Dark segment via `setMode` / `resetMode` from mode-watcher. Theme stays a browser setting: the first frame without a flash comes from mode-watcher's inline script from localStorage, and a server setting cannot do that.
- `Settings` (`⌘,` — a new chord).
- `Agent library`: opens `AgentLibraryOverlay` with `contextProject.id`, disabled without a project. So that saving a definition refreshes types in every open thread, the agent-type list moves from each `HarnessHost` into one project-level service.
- `Keep awake` adds [[63cec91b]].

**Leaving the header**
- Brand: the Gem and the TAGMA wordmark. The Archivo font (`@fontsource-variable/archivo`), the `--font-mark` token and the `.mark` style go with it.
- Connection indicator (“wire-vein”) moves to the status bar ([[63cec91b]]).
- “Search blocks” button — the centered field takes its place.
- Dock switcher — [[5c88840b]] removes the Dock.
- Settings icon — moves to the menu.
- Theme switcher — moves to the menu.

**Dialogs currently mounted only in the header** stay mounted in it, inside `{#key projectKey}`: `FinishDialog`, `CleanupDialog`, the switcher's `NewWorktreeDialog`. The New project dialog moves out of `TopBar.svelte` into its own file.

**Desktop.** The header height changes, so the window-button position changes too. In `apps/tagma/desktop/src/main.ts`, `trafficLightPosition` is recalculated for 36 px: currently `{x:14,y:20}` for 52, and for 36 the button center should sit at about 18 px. Consumers of `--topbar` (`NoticeCards`, `BlockPage`) read the token and need no changes.

## Rail

`NavigationRail.svelte`, `SURFACES` in `lib/features/workspace/address.ts`.
- Always five same-size icons: Agents, Knowledge, Checkout, Journal, Rules. No subgroups.
- Knowledge highlighted on the outline, on the block page and on the graph.
- Rules move to `navigation: 'primary'` and highlight on `/rules`. Currently nothing highlights on `/rules`: the `knowledge` predicate does not include Rules.
- Map and Graph leave the rail: Map is deleted, Graph becomes a view inside Knowledge ([[46f2f6ef]]).
- The “show or hide the section column” button moves from the subgroup to the bottom of the rail. Sections that have a column show it. `⌘\` becomes shared for any section's column: currently it works only for the knowledge index. Hiding the agents column is built by [[5c88840b]].

## Thread title

`routes/[project]/chat/+layout.svelte`, `lib/features/threads/Header.svelte`, `TeamStrip.svelte`. Title height 32. The team strip (`TeamStrip`) is removed as a separate row.

**Left to right**
- Name: renamed by click at the root, as now.
- Crumb to the parent or to the originating thread.
- Worktree chip.
- Team button.
- Chips for only those children that are working or awaiting a reply: up to three, then `+k`.
- Right: terminal with counter, changes with counter, and the `…` menu. Changes get their own icon: currently `PanelRight` matches the outline-links switcher.

**Team button**
- Label: `Team · 14 · 2 running`. No children, no button.
- Popover lists direct children in Working, Waiting, Failed, Done groups, with state dots. States come from `teamChips` and `ThreadList` rows; the client computes nothing again.
- Clicking a child opens it in a panel next to the parent ([[5c88840b]]). Until panels exist — by navigation, as now (`host.open`).

**Moving into the thread `…` menu**
- Model account: an `Account: <label>` row. The missing-account warning (`accountMissing`) stays visible in the title as an icon with a tooltip, because the next turn depends on it.
- `Copy thread ID`.
- Born-as: “View this thread's prompt” and “New thread as…”. The born-as chip itself shows only when the thread was born as something other than the default agent: currently “Tagma” sits on every thread.

## Where it moves

- Projects, New project, worktree, Finish, Cleanup — header, left.
- Block search — ⌘K ([[0ed5d929]]).
- Chat with the Tagma agent from any surface — a panel beside ([[5c88840b]]).
- Settings, Theme, Agent library, Keep awake — app menu.
- Connection state — status bar.
- Map, Graph — Knowledge.
- Rules — rail.
- Knowledge index button — bottom of the rail and `⌘\`.
- Team — button in the thread title.
- Account, id, born-as — thread `…` menu.

## Acceptance

- On chat with a 14-child team, 68 px above the first message.
- On every section the rail is identical, exactly one item highlighted, Rules on `/rules`.
- In desktop on macOS the window buttons sit centered on the header and do not overlap the project switcher. The window drags by the header's empty spots, and clicks on its elements are not lost.
- The app menu switches the theme to System, Light and Dark and back to System.
- Every item under “Where it moves” is reachable. Verified by walking the sections with screenshots.
