---
id: 01a0d82c-e21f-7369-89d0-d1805fc8b0bd
title: Each place keeps whether its terminal panel is shown and which tab and pane are active, and a reload restores all three
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## Outcome

- **The panel's shown state belongs to the place, like its tabs.** Take a panel shown in worktree A, which holds 3 terminals:
  - moving to a thread of worktree B, where the panel was never shown, draws it hidden;
  - moving to any thread of worktree A draws it shown again;
  - two threads of one worktree always agree.
- **⌘J, Ctrl+`, the header toggle and the Hide button** show or hide the aimed place's panel only.
- **Closing a place's last tab hides that place's panel.**
- **A reload restores each place as the operator left it:**
  - whether its panel was shown;
  - which tab was active: tab 2 of 3 stays tab 2, not the last;
  - which pane was active inside each tab.
- **The panel's height stays one app-wide habit**, as the column widths are.

## Problem

The operator's words (2026-09-25):
- Opening the terminal panel in a thread of one place leaves it open in every other place, including places with no terminals.
- After a reload, the strip lands on the last tab instead of the one the operator was in (a screenshot showed tab 3 of 3 selected after leaving tab 2).

## What holds now

Read in the code on 2026-09-25.

- **Shown state.** `TerminalPanel` (`TerminalPanel.svelte.ts`) holds one `shown` flag, stored in local storage under `tagma.terminalPanel` and read again at every mount ([[dc1a3505]]). `showing(rootId)` is that flag AND mounted AND aimed at the root. `TerminalPlaces.toggle`, `reveal` and `openIn` flip or set it for all places at once. The Hide button calls `panel.toggle()` directly, and `TerminalToggle.svelte` reads `panel.shown`.
- **Active tab.** `PlaceTabs.snapshot()` stores `order`, `tabs` and `closed`, but not the active tab. `PlaceTabs.adopt` selects the last tab when none is active (`this.tabs[this.tabs.length - 1]`). `StoredTab` does not store a tab's active pane either.

## Target model

- **A place's layout carries its view state.** `StoredLayouts` in `placeLayouts.ts` gains three optional keys:
  - `shown: boolean` on the place;
  - `active: string | null` on the place: the key of its active tab;
  - `active: string | null` on each `StoredTab`: the execution key of its active pane.

  All three ride the one project setting `terminal.placeLayouts` ([[e2bb3ac8]]) and are written by the same persist that writes the tabs.
- **The place owns whether it is shown.** `PlaceTabs` holds `shown`. `TerminalPanel` keeps only what is the page's:
  - `mounted`;
  - the aimed row.

  The panel's shown state is derived from the aimed place's strip: shown when that strip is shown, hidden when there is no strip. The builder chooses the exact shape. The dependency direction stays as it is: `TerminalPlaces` reads `TerminalPanel`, never the reverse. A reader that needs the aimed place's shown state reads it through `TerminalPlaces` or a derived value it owns.
- **Every act that shows or hides names its place.**
  - The toggle and the Hide button act on the aimed place.
  - `reveal(key)` and `openIn(row)` show the place they land in.
  - Closing a place's last tab hides that place.
  - Each act persists.
- **A reload restores.** When `adopt` births a place's tabs:
  - it selects the stored active tab if it was born, and falls back to the last tab only when it was not;
  - it restores each tab's stored active pane when that leaf was born;
  - a place's stored `shown` decides whether its panel is shown.
- **A place never stored defaults to hidden.**

## Owners and boundaries

App only: `apps/tagma/app/src/lib/features/terminals`, namely `placeLayouts.ts`, `PlaceTabs.svelte.ts`, `TerminalTab.svelte.ts` (the active pane it reports and accepts), `TerminalPlaces.svelte.ts`, `TerminalPanel.svelte.ts`, `TerminalPanel.svelte` and `TerminalToggle.svelte`. No server change: the setting's value is an opaque JSON document to the server's settings door. The builder confirms this against `protocol/settings.ts` before relying on it.

## Rejected

- **Shown state per thread.** Two threads of one worktree share one set of shells ([[91f03b67]]). A per-thread flag would fold and unfold the same terminals while the operator moves between those threads, and hide a running dev server for no reason.
- **Keep the app-wide flag and hide the panel only where a place has no tabs.** A place with tabs the operator hid would reopen whenever it is visited, which is the complaint turned inside out.

## Acceptance

- Show the panel in place A, move to a thread of place B that has no stored state: hidden. Move back to a thread of A: shown. Two threads of A agree.
- ⌘J in B shows B and leaves A as it was.
- Select tab 2 of 3 and a non-default pane in a split tab, then reload: tab 2 and that pane are active, and the panel's shown state per place is what it was.
- Close the last tab of a place: its panel hides, and a reload keeps it hidden.
- A stored value written by the current app, without the new keys, still loads its tabs. Those places read hidden, and the active tab falls back to the last.
- `reveal` from Processes and a worktree menu's Open terminal still land shown, on the right tab.
- Tests protect the contract: the round trip of the three keys through `parseStoredPlaces` and `snapshot`, the restore of the active tab and pane in `adopt`, and a toggle in one place leaving another alone. No test of words or layout (law f0530b87).
- App typecheck is clean, and the terminals suites pass.

## What becomes of claims and tasks

- [[dc1a3505]] is rewritten: the shown state is the place's, stored with its layout; the height stays the app-wide `terminals` pane.
- [[e2bb3ac8]] is extended: each place's value also holds its shown state and its active tab and pane.
- [[47ab3d0d]] is extended: a reload re-selects the stored active tab and pane.
- [[e4e5958f]] and [[3ea6fc55]] are re-read and reconciled where they say "the panel shown".
- The builder rereads every other claim under [[694602e9]] whose file it changes, and verifies only what holds.

## Order of building

1. Stored shape and parse.
2. Snapshot and adopt restoring the active tab and pane.
3. The shown state moved to the place, with every show and hide act.
4. The old key's upgrade.
5. Claims.

## 10–17

- **10 Contract:** additive optional keys in a setting's JSON value, with no wire or operation change.
- **11 Stored data:**
  - The new keys are optional. An old value decodes with them absent, and the app writes them from its next persist.
  - Upgrade: on the first load, if local storage still holds `tagma.terminalPanel`, the place aimed at that moment takes its value, and the key is removed.
  - Rollback: an older app drops the unknown keys on its next write. The only cost is that shown state and active tab fall back to the old behaviour.
- **12 Who may do what:** out: operator UI state in the operator's own project setting.
- **13 Long-lived things:** out: no new process or subscription; the strips' lifetime ([[cc3c6e3b]]) is unchanged.
- **14 Bounded resources:** out: three small fields per place, in a value that already holds each place's tabs.
- **15 Rollout:** an app reload. Running shells are untouched.
- **16 Failures:** a persist that fails keeps today's single notice. A value the parser rejects drops that place's view state with its tabs, as today ([[7abe1b93]]).
- **17 Observability:** the acceptance items are checked live on an isolated server (`tagma:try`), with two places and a reload.

## Divergences accepted in the build

- **A server change was needed.** The settings door decodes `terminal.placeLayouts` through an Effect `Schema.Struct`, which drops unknown keys when the value is read back, so the new keys would have been written and then lost on the next load. `protocol/settings.ts` gains them as `Schema.optionalKey` fields: `shown` and `active` on `terminalPlaceLayout`, `active` on `terminalStoredTab`. An old value still decodes, and the wire and the operations are unchanged.
- **Selecting a tab or a pane now writes the setting.** The stored active tab and pane have to follow the operator, so these writes are far more frequent than the tree acts that wrote before. `TerminalPlaces` keeps one write in flight and sends only the latest value after it, so overlapping requests cannot land an older selection last.
- **Accepted limitation: two windows on one project overwrite each other.** Each window reads the stored value once and rewrites it whole from memory, so a window's next write reverts another window's shown state and active tab. Tab arrangements already behaved this way. Before this build, the shown flag was shared through one browser's local storage and re-read at every mount.
- **Beyond the promise:** reopening a closed tab also restores its active pane, since the reopen stack stores it in the same shape.
- **The legacy flag yields to a choice already made.** A show or hide made before the first reading keeps precedence over `tagma.terminalPanel`.
