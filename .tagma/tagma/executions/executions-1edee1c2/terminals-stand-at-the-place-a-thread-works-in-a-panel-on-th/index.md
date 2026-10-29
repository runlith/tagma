---
id: 01a0d56a-9822-7318-a60c-f95550e84f6a
title: "Terminals stand at the place a thread works in: a panel on the Agents page per worktree, Processes as its own section, and a CLI started in a terminal as a thread"
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/terminals
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/address.ts
---
## Outcome

The operator works in one place, the Agents page, and the terminals of that work stand there. Under the thread on screen, a panel shows the terminals of the place the thread works in: its worktree, or main. Tabs and splits live in that panel and nowhere else. Two threads in one worktree share one set of shells, so a dev server started beside one thread is still there beside the other. Moving to a thread in another worktree shows that worktree's terminals.

- The Terminals section and the floating terminal are gone.
- Everything that runs in the project is its own section, Processes, grouped by owner. Every line leads to the owner it belongs to.
- A harness CLI launched from Tagma never stands as a terminal tab: its pty is its thread's page.
- A CLI the operator starts by hand in a Tagma terminal becomes a thread that lives in that terminal. No agent works in the shared checkout unseen.

## Problem

The Terminals section is a copy of Orca's terminal page, and it was placed as a section of its own. The operator's words (2026-09-24): all work happens on the Agents page, nobody opens Terminals, and the section may not need to exist at all. The measured faults:

- **It shows what is not a terminal.** The roster adopts every running pty the operator holds ([[ee4c2bc7]]). A harness launch is started as the operator (`harnessPlace` in `harness/harnessLaunch.ts`), so every CLI launched from Agents also stands as a Terminals tab and as a terminal line in the drawer.
- **It belongs to nothing.** The strip is one per project ([[e2bb3ac8]]). A new terminal opens in whatever worktree the frame aims at ([[d0668908]]), and the strip mixes every worktree's shells in one row. A tab's worktree is guessed from its folder by path prefix (`holding(tab.root)` in `TerminalTabStrip.svelte`), because no record says it.
- **The work page has none.** A thread page offers no terminal of its own place. The floating terminal is a third projection that belongs to no worktree either.
- **A CLI typed into a shell is invisible.** Its hooks stay silent without a grant (`ungranted` in `cli/hooks.ts`), and its MCP calls sign as a foreign session. It edits the shared checkout, and no thread, report or change record names it.

## What holds now

Read in the code on 2026-09-24.

- **The strip.** `TerminalTabs` is a project-tier service. It reads the standing roster once, adopts operator-held pty executions in the running or starting phase, and persists one project setting, `terminal.tabLayouts` (`protocol/settings.ts`). That setting holds tabs, order, titles, pane labels and the reopen stack. The strip also holds the floating panel (`TerminalFloating`), which it toggles.
- **The page.** `/[project]/terminals/[[id]]` mounts `TerminalsScreen`, which holds the strip and the `ProcessesDrawer`. `TerminalsPage.svelte` answers tab and pane chords on the window.
- **Harness threads.** They draw one pane per thread, held by `ThreadPanes` ([[1b8de5f5]]). That pane is the thread's own pty and stands on its page with no strip ([[967d46cc]]).
- **Processes.** The drawer is `ProcessesDrawer`, a project-tier service over the shared `CommandActivity` fold. It opens only on the Terminals page. The thread badge (`ActivityBadge.svelte`) and the peek (`ThreadPeek.svelte`) send the operator there through `processesHref`, and a terminal line goes to `placeHref(…, 'terminals', key)`.
- **Terminal records.** `TerminalRecord` in `protocol/terminals.ts` names the holder, origin, cwd and a root use. It names neither the root it stands in nor the thread whose harness launched it.
- **Worktree finishing.** Archive refuses `root-in-use` while a terminal or command holds the worktree's root (`WorktreeFinishing.unused`). The operator must end every shell by hand before archiving.

## Target model

- **A place owns its terminals.** A place is a root of the project's worktree listing, main included, keyed by its `rootId`. Every terminal record names the place it was started in and, for a harness launch, the thread it serves ([[e8d26502]]).
- **The Agents page has a terminal panel** ([[91f03b67]]):
  - it draws the tabs of the frame's place, which the open thread aims ([[899e018f]]);
  - tabs and splits are the panel's alone;
  - the tabs of every place stay alive in the project's scope while hidden.
- **Processes is a section** ([[ba15d2f5]]). It is a monitor: lines grouped by owner, each leading to where it is worked — a place's tab, a command's output, a thread.
- **A worktree's end takes its terminals** when the operator agreed to it in the finishing dialog ([[4f4df24b]]).
- **A CLI started in a Tagma shell is adopted** as a harness thread whose session lives in that shell ([[7a4219f5]]). The shell stays the operator's.

## Owners and boundaries

- **App** (`apps/tagma/app`):
  - `features/terminals`: the places' tabs, the panel and the pane (the engine is unchanged);
  - `features/harness`: the thread page, the badge and the peek;
  - `features/frame` and `features/workspace/address.ts`: the rail and the addresses;
  - `features/worktrees`: the finishing dialogs;
  - `routes`.
- **Server** (`apps/tagma/server`):
  - `terminals`, `db/terminals.ts` and `protocol/terminals.ts`: the record's place and service;
  - `protocol/settings.ts`: the layout setting;
  - `working/WorktreeFinishing.ts` and `protocol/operations/finishing.ts`: ending at finishing;
  - `harness`, `cli/hooks.ts`, `cli/door.ts`, `http/caller.ts`, `protocol/grant.ts` and `skill`: adoption.
- **Unchanged:** the host and its wire (`packages/execution-host`, `packages/executions`). No part of this spec raises the host's wire, so none of it waits on a host replacement.

## Rejected

- **Keep the Terminals section and add a panel beside it.** Two projections of one set of shells, each with its own tabs and focus — the colkhoz the operator named.
- **Terminals owned by the thread.** Threads in main would each hold their own shells, and a dev server would vanish whenever the operator moves between two threads of one worktree. A worktree is where a terminal's work lives: its folder, its branch and its servers.
- **Tabs for threads.** The thread list is already the list of open work, with states and worktree groups. A tab strip of threads would be a second, poorer copy of it.
- **A terminal as a kind of thread.** A thread is an agent — turns, a transcript, reports, a model — and a shell has none of these. A shell stays a terminal of its place. What becomes a thread is the agent CLI running inside it.
- **Leave hand-started CLIs as plain processes.** An agent editing the shared checkout that no thread, report or change record names is the defect this product exists to prevent.

## Acceptance

- The rail lists Agents, Outline, Checkout, Processes and Journal, then Map and Graph. No Terminals entry and no `/terminals` route stand.
- The acceptance of each child holds.
- A full `bun run check` in `apps/tagma` passes, and each child names its own suites.

## Built — divergences

- `apps/tagma` has no `check` script. The acceptance was run as each package's `typecheck` and `test` on e88b55e71b:
  - app typecheck: 0 errors;
  - app tests: 955 of 956 pass. `streamComposition` timed out under the full parallel run and passes alone (3/3, twice);
  - server typecheck: clean;
  - server unit tests: 818 of 822 pass. `operations.test.ts` passes alone. The two timeouts in `hostReplacement.test.ts` and `enforcement/eventLoop.test.ts` also fail alone, in files this spec did not touch.
- The children's divergences stand in each child's own "Built — divergences" section.

## What becomes of what stands

Verdicts for the docs under [[2c8c1d90]], executed when each child closes:

- **[[fe4e48f2]] What one terminal pane is: survives whole.** The pane, its engine, input, output and record stream are unchanged. The rule [[868d8c63]] binds the panel as it bound the page.
- **[[2739a187]] How a terminal is drawn: survives whole.** The page-wide render policy suspends and reveals by the same transitions. The panel reveals a place's tabs where the page revealed the strip's.
- **[[694602e9]] Panes, tabs and where a terminal is shown: redrawn by [[91f03b67]].**
  - The split tree and the tab survive: the claims over `paneLayout.ts`, `TerminalTab.svelte.ts`, `TerminalPaneTree.svelte`, `TerminalPaneHost.svelte`, `TerminalDivider.svelte`, `TerminalPaneTitle.svelte` and `TerminalContextMenu.svelte`.
  - The harness registry survives: [[1b8de5f5]], [[aa1dd228]], [[967d46cc]], [[c8a03e77]] and [[ffb43062]].
  - The project strip's claims are absorbed into the per-place strip and rewritten for it: [[e2bb3ac8]], [[47ab3d0d]], [[3b6423d2]], [[2edd5338]], [[64a0e012]], [[9944bb2e]], [[74f1ee3a]], [[d0668908]], [[ee4c2bc7]], [[d9bba8a8]], [[35d73b55]], [[077ef59e]], [[d2d0d8a6]], [[60a1aad9]], [[2b43e309]], [[7777115c]] and [[11762d6d]].
  - The page's claims are absorbed into the panel: [[027fb6c4]], [[dc4c2ea2]] and [[07d3053e]].
  - Dies with the floating terminal and the section: 720b2198, 36d62aae, 6b024e71 and f012ed6b, deleted when [[91f03b67]] closed.
- **[[8aa8264c]] The project's command work: survives.** The drawer's claims are absorbed into the section by [[ba15d2f5]]: [[d970ca18]], [[8a1eb50c]], [[8481b913]], [[59195588]], [[b0093c88]], [[d1a767ca]], [[1641f184]] and [[648b63f3]].
- **Standing work:**
  - [[4ca6657a]] is absorbed by [[91f03b67]], whose persistence writes nothing before a roster reading succeeded.
  - [[99f99290]] is absorbed by [[91f03b67]], whose chord owner decides `editable` the way the host does.
  - [[02352b2d]] is absorbed by [[ba15d2f5]], which rewrites the drawer's words as a page's.
  - [[da80d060]] survives: a dead act, not a placement question.
- **Standing findings:**
  - `spec-idle` on [[7aec9851]] survives: its phases are closed, its root is not this spec's, and nothing here contradicts it.
  - The three `language-unread` findings survive: they are about a missing Svelte region reader.

## Order of building

[[e8d26502]] → [[ba15d2f5]] → [[91f03b67]] → [[4f4df24b]] ∥ [[7a4219f5]]. Processes lands before the panel because it moves the drawer off the page the panel removes. Finishing and adoption are independent of each other.

## 10–17 across the children

Each child answers them for its own change. Cross-cutting:

- **10 Contract:** additive optional keys on `TerminalView` and the finishing inputs; one new operation; hook and bridge doors that keep their shape for every caller that carries a grant.
- **11 Stored data:** two nullable terminal columns ([[e8d26502]]), one setting replaced by a migrated one ([[91f03b67]]) and harness session fields that decode old rows ([[7a4219f5]]).
- **15 Rollout:** an ordinary server restart lands every child. No host replacement is due, so running terminals survive the rollout.

The rest belong to the children.
