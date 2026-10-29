---
id: 01a0d56a-989a-7212-b4b0-46f491f03b67
title: Each worktree's terminals stand in a panel under the thread on the Agents page, and the Terminals section and the floating terminal leave
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Keymap.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/TerminalFloating.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/TerminalsPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/TerminalTabs.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/routes/[project]/chat/+layout.svelte
  - kind: file
    ref: apps/tagma/server/src/protocol/settings.ts
---
## 1 Outcome

The Agents page has a terminal panel under the thread.

- **What it shows.** It draws the terminals of the frame's place: the worktree the open thread stands in, which the page already aims the frame at ([[899e018f]]), or the one the operator chose in the switcher.
- **The header.** It names the place (tone and branch), then the place's tabs, `+`, split and fold.
- **Toggling.** A chord (⌘J on macOS) or the Terminal button in the thread header shows or hides the panel. The button carries the count of the place's live tabs.
- **Height and shown state.** A horizontal seam sizes the panel. Its height and whether it is shown are app-wide habits kept like the column widths.
- **Moving between threads.** A thread in the same worktree keeps the same tabs, with nothing restarted. A thread in another worktree shows that worktree's tabs. Every place's tabs stay alive, and are only hidden, while another place, another page or a folded panel is on screen.
- **New shells.** A new shell opens in the place's folder.
- **What stands as a tab.** An agent's own pty terminal stands as a tab of its place, named by its holder, with Take over as today. A pty a harness session launched is never a tab: it is its thread's page.
- **Links.** Every link that named a terminal now opens the panel on that terminal's place with its tab selected and its rim flashed. That covers the badge, Processes and the worktree menu's Open terminal.
- **What leaves.** The Terminals section, its route `/[project]/terminals/[[id]]`, its rail entry and the floating terminal are gone.

## 2 Problem

The strip is one per project and stands on a page nobody opens. It adopts harness CLIs as tabs, and it mixes every worktree's shells in one row. The Agents page, where the work is, has no terminal of its own place. Evidence is in the root, [[50e84f6a]].

## 3 What holds now

- **The strip.** `TerminalTabs` (`features/terminals/TerminalTabs.svelte.ts`, project tier) does all of this:
  - reads the roster once;
  - adopts operator-held ptys running or starting;
  - births `TerminalTab`s in child scopes;
  - persists `terminal.tabLayouts` whole on every tree act;
  - keeps the reopen stack (32), the Ctrl+Tab recency (32), rename and close asks;
  - toggles `TerminalFloating`.
- **Visibility.** A tab is visible while it is the strip's active tab ([[3ea6fc55]]). The page's render policy suspends and reveals every pane across page transitions ([[4db0b322]]).
- **The page.** `TerminalsPage.svelte` draws the strip (`TerminalTabStrip.svelte`), every tab's `TerminalPaneTree` (off-screen ones `display: none`), the drawer and the close dialog. It answers strip and pane chords on the window except inside the engine and a field ([[027fb6c4]]).
- **The floating terminal.** `TerminalFloating` is mounted in `routes/+layout.svelte` and raised by the `floating-terminal` chord row (`Mod+Alt+A`).
- **Harness panes.** A harness thread's pane is `ThreadPanes`' and stands on its page (`HarnessTerminal.svelte`).
- **The chat layout.** `routes/[project]/chat/+layout.svelte` draws the thread column and a `main` holding the header, the team strip and `ThreadMain`, which holds the conversation and the side diff.
- **Links into the section.** `WorktreeMenuItems.svelte` opens a shell and navigates to the Terminals page. `ActivityBadge.svelte` sends a terminal line to `placeHref(…, 'terminals', key)`.

## 4 Target model

### `TerminalPlaces` — the project's terminals by place

This project-tier service replaces `TerminalTabs`. It owns:

- the one roster reading, with its ceiling and the floor's word;
- which standing pty stands as a tab in which place;
- the persistence of every place's arrangement;
- `reveal(key)`.

It reads the roster from [[e8d26502]]:

- A standing pty (running or starting) without `launchedFor` is a tab of the place its `rootId` names, whoever holds it. The operator's shells carry no holder chip. A thread's terminal carries the thread's name ([[b2cf32c8]]).
- A pty with `launchedFor` is never a tab.
- A pipe is never a tab: it is a command, and Processes shows it.

After the first reading, the places **follow the standing rows live** through the shared fold's feed (`CommandActivity` already follows them, [[d106c98f]]). A pty a thread starts appears in its place at once. One that ends is shown ended, as a pane shows an ending today.

### `PlaceTabs` — one place's strip

This is today's `TerminalTabs` minus the roster, for one place. It is born by `TerminalPlaces` in a child scope per `rootId` and owns:

- the tabs, their order, titles and active tab;
- the Ctrl+Tab recency and the reopen stack (32 per place);
- rename, and the close asks and sweeps ([[d9bba8a8]], [[35d73b55]]);
- opening a shell in the place's folder;
- detaching a pane to a new tab;
- the strip acts.

A tab's `visible` closure answers: the panel is shown, on the Agents page, aimed at this place, and this tab is the place's active one. It is read live ([[868d8c63]]).

### `TerminalPanel` — whether and where the panel shows

This project-tier service owns:

- `shown`, persisted app-wide in local storage;
- the aimed place: `Worktrees.aimed`, `null` when the address names no standing checkout;
- whether the Agents page has the panel mounted;
- `toggle()`, and `reveal(key)` on the page's side, which navigates.

Its height is a Panes entry, `terminals`, on the vertical axis like `log`.

### The panel component

`TerminalPanel.svelte` is mounted by the chat layout as the last row of `main`, beneath `ThreadMain`, behind a `SeamHandle`. It draws:

- the header: the place chip, `TerminalTabStrip` for the place's `PlaceTabs`, `+`, split and fold;
- every tab of the place, the ones off screen `display: none` ([[dc4c2ea2]]);
- the floor's notice;
- the reading, failed and empty states: an empty place offers New terminal with the place's folder;
- `CloseTerminalDialog`.

With no aimed place it says that this address stands in no worktree, and offers nothing to open.

### Chords

- **The toggle row.** The `floating-terminal` row becomes `toggle-terminals`: scope `global`, `allowInTerminal`, `Mod+J` on every platform. A tab-host alternate is added only where the browser owns the chord ([[731d6bc2]]). It answers anywhere on the Agents page.
- **Strip and pane acts.** They answer only while the keyboard is inside the panel: an engine or the panel's own chrome. The composer and the thread column keep their keys.
- **Editable.** The panel decides "editable" by the same test the pane's host uses, which closes [[99f99290]].

### Addresses

- `terminalHref(key)` is `/[project]/chat?terminal=<execution>:<incarnation>`. The chat layout answers the parameter with `TerminalPlaces.reveal(key)`, which does four things:
  - finds the tab, or births it from the record ([[74f1ee3a]]);
  - replaces the address's `branch` with its place's;
  - shows the panel, selects the tab and flashes the rim ([[11762d6d]]);
  - drops the parameter.
- The worktree menu's Open terminal navigates to the worktree's branch on the Agents page, shows the panel and opens a shell in that place.

### Removed

- `TerminalTabs`, `TerminalsScreen`, `TerminalsPage.svelte`;
- the route `routes/[project]/terminals`;
- `TerminalFloating` (service, component and the root layout's mount);
- the `terminals` surface in `SURFACES` and `SEGMENT`.

## 5 Owners and boundaries

- **`features/terminals` owns** `TerminalPlaces`, `PlaceTabs`, `TerminalPanel`, the panel component and the chord row. The pane, its engine, the render policy, the split tree and `TerminalTab` are unchanged.
- **`routes/[project]/chat/+layout.svelte`** mounts the panel, answers `?terminal=` and places the header button.
- **`features/workspace/address.ts`** gets `terminalHref` and loses the `terminals` surface.
- **`features/reading/Panes.svelte.ts`** gets the `terminals` pane.
- **`features/harness/WorktreeMenuItems.svelte`** and **`ActivityBadge.svelte`** move to the panel's roads.
- **The server's `protocol/settings.ts`** gets the new layout key and a migration.
- **Boundary.** The panel knows places only as `rootId`s from the worktree listing. It never derives a place from a path.

## 6 Rejected

- **A panel per thread.** See the root: threads of one place share their shells.
- **Keep the floating terminal as a quick shell.** It is a projection of no place. The panel's toggle is the quick road now.
- **Answer strip chords anywhere on the Agents page.** `⌘T`, `Ctrl+Tab` and digits would reach the terminals while the operator is typing to a thread.
- **Keep one project-wide strip and filter it by place on screen.** One order, one reopen stack and one recency for every place would mean closing a tab in main reopens a worktree's.

## 7 Acceptance

- **Place switching.** Two threads in one worktree, a shell running `sleep 1000` in its panel: moving between them shows the same tab with its scrollback, and the process was never restarted. Moving to a thread in main shows main's tabs.
- **New shells.** A new shell from the panel reports `pwd` as the place's folder.
- **Harness CLIs.** A harness thread launched from Agents appears in no panel.
- **Agent terminals.** A terminal an agent opens with `start_terminal` appears as a tab in its place, named by the thread, while the panel is shown.
- **Folding.** Folding the panel keeps every shell running. Reopening shows them as left, and the page never re-read a record for a tab that stayed alive.
- **Chord scope.** `⌘J` toggles from the composer, from a pane and from the conversation. `⌘T` inside the panel opens a tab. In the composer it does nothing to the terminals.
- **Links.** A badge's terminal line and the worktree menu's Open terminal land on the Agents page aimed at the place, with the tab selected.
- **Reload.** A reload restores each place's tabs, order, titles and splits.
- **Upgrade.** After the upgrade, the arrangement saved under `terminal.tabLayouts` stands in the places its shells run in.
- **Removals.** `/[project]/terminals` answers the app's not-found, and no rail entry names Terminals.
- **Tests.** The strip's suites move to `PlaceTabs` and `TerminalPlaces`, keeping the contracts they protect: adoption, persistence, close asks and reopen. The floating suite and the page suite that tested removed code are deleted.

## 8 What becomes of what stands

- The docs of [[694602e9]] follow the root's verdicts.
- [[4ca6657a]] is closed by this change: persistence arms only after a roster reading succeeded.
- [[99f99290]] is closed by this change.
- [[d0668908]] is rewritten: a new shell opens in the panel's place, and the tab tone rule leaves, because a panel holds one place.

## 9 Order

1. The settings key and its migration.
2. `PlaceTabs` extracted from `TerminalTabs`, and `TerminalPlaces` over the roster with [[e8d26502]]' keys.
3. `TerminalPanel` and the panel component, mounted in the chat layout.
4. The chord row and the header button.
5. Addresses, the worktree menu and the badge.
6. Removal of the section, the route and the floating terminal.

## 10 Contract

- **The new setting.** `terminal.placeLayouts` (machine-written) holds `{ places: Record<rootId, { order, tabs, closed }> }`. Each place's value has the shape `terminal.tabLayouts` has today.
- **The address.** `?terminal=` is an app address, not a server contract.

## 11 Stored data

- **The migration.** A server migration converts each project's `terminal.tabLayouts` row:
  - a stored tab joins the place its first leaf's execution row names ([[e8d26502]]);
  - a tab whose leaves name no row is dropped, as the store always dropped dead leaves ([[47ab3d0d]]);
  - the reopen stack joins the canonical root's place.
- **The old key.** The migration then deletes the old key's rows, and its declaration leaves `SETTING_KEYS`.
- **Rollback.** An older build reads no layout and adopts the live shells one tab each, as a fresh project does.
- **Panel habits.** The shown flag and the height are local storage: a malformed record reads as the defaults.

## 12 Who may do what

The panel types and stops through the same doors as the Terminals page did. Nothing new is granted.

## 13 Long-lived things

- **Per-place strips.** A `PlaceTabs` lives in the project's scope from its first tab or first aim until the project's scope ends.
- **A place that leaves the listing.** Its strip is kept while it holds a live tab. [[4f4df24b]] ends those tabs when the operator archives. Once it holds none, it is dropped, and so is its stored arrangement at the next write.
- **The hidden-engine budget.** The page's six hidden contexts ([[53de244f]]) bound the engines across every place.

## 14 Bounded resources

- 32 reopen entries and 32 recent tabs per place.
- One persisted document per project, written whole: its size is the operator's own tabs.
- No new reads per place: one roster reading and the shared feed serve all places.

## 15 Rollout

A server restart runs the migration. Open pages reload into the new surface, and running shells are adopted by their places.

## 16 Failures

- **A failed roster reading.** The panel shows the refusal with Retry, never an empty place ([[2edd5338]]), and writes nothing.
- **A lost start reply.** It is read back under its key as today ([[218a0405]]).
- **An address naming an execution the roster does not hold.** The record is read. If it is a pty with a place, it is born as a tab there. Otherwise the page says the terminal is gone and drops the parameter.

## 17 Observability

- The panel keeps the page's keystroke-chain and replay marks ([[07d3053e]]) under the same names.
- The panel draws the reading's own state — reading, failed with its refusal, or read — and never a guess.
- `TerminalPlaces` answers each place's tab count, which the header button prints.

## Divergences in the build ([[3624e501]])

Accepted by the operator through the parent session unless noted as the builder's own.

1. **Live following adopts only a thread's terminals.** A split's fresh shell reaches the feed before its pane binds it, so adopting the operator's rows live would birth it as a stray second tab. The operator's shells opened elsewhere appear at the next roster reading. Each key is adopted once.
2. **`reveal` answers the parameter; links navigate.** `TerminalPlaces.reveal` is called by the chat layout for `?terminal=`, and every link navigates to `terminalHref`. `TerminalPanel` holds no `reveal`.
3. **A `launchedFor` address leads to the thread's page**, not to "gone".
4. **The toggle from a harness pane is forwarded**, and showing the panel puts the keyboard in the active tab.
5. **An unreadable settings catalog fails the reading** with Retry, like a failed roster, and writes nothing.
6. **The chord off macOS.** Ctrl+J is LF — accept-line in readline, a motion in vim — so taking it from every shell would break them. macOS keeps `Mod+J` (⌘J) everywhere. Off macOS, `Ctrl+`` toggles everywhere, terminals included, and Ctrl+J toggles only outside a terminal.
7. **Rollback (§11) does not hold.** The migration chain check refuses to start an older build over a database that applied a later migration, so an older build does not read "no layout"; it does not start.
8. **Reveal waits for the worktree listing** before aiming (builder's own). Aiming before the listing is read left the frame on main while the tab stood in a worktree.
9. **The toggle does nothing where the panel is not mounted** (builder's own). ⌘J from a floating harness panel off the Agents page would otherwise flip the hidden flag with nothing on screen.
10. **The tab tone rule left**, as §8 said for [[d0668908]]; the place chip in the header carries the tone.
11. **A known leftover.** The MachineRegistry seeds a deleted `terminal.tabLayouts` row back from an older registry dump as an inert row ([[369828ac]]).
