---
id: 01a0d56a-9877-7409-bdab-41b2ba15d2f5
title: Processes is a section of its own, and every line in it leads to its owner
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/ProcessesPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/ProcessesSection.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/processLines.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ActivityBadge.svelte
---
## 1 Outcome

Processes is a section of its own: a rail entry between Checkout and Journal, at `/[project]/processes`. It shows everything the project's executions are doing now, and what ended recently, grouped by owner:

- each thread, with its place's tone;
- the operator, one group per place;
- Tagma's internal work;
- archived owners whose work still runs, at the foot.

It keeps what the drawer does today:

- the filter chips and the search over words and ports;
- the load sums;
- the output face of a command;
- stop and more-time on a line ([[cacb4a15]]);
- the walk over ended work.

Every line leads to its owner:

- a terminal line opens the terminal panel on its place with its tab selected;
- a command line opens its output face in the section;
- a group's header opens its thread.

Every road that led to the drawer lands here: the thread badge's Processes link, the peek's, and a command line opened from the badge. The standing chip's menu in the status bar gains Open Processes.

## 2 Problem

The drawer is a fold at the bottom of a page the operator never opens. The thread badge and the peek send the operator to the Terminals page just to see a thread's processes. A project-wide monitor is a section's job, not a terminal page's drawer.

## 3 What holds now

- **The owner.** `ProcessesDrawer` (`features/terminals/ProcessesDrawer.svelte.ts`, project tier) holds the open flag, the tab (lines or output), the filter, the search, the folded groups, the output line, the stream choice and the aimed group, over `CommandActivity.forProject()`.
- **Its page.** `ProcessesDrawer.svelte` draws it inside `TerminalsPage.svelte`, and `TerminalsScreen` holds it for the route.
- **The roads in.** `processesHref(thread)` addresses `/terminals?processes=<thread|operator>`, and the Terminals route answers it with `jumpTo` ([[b0093c88]]). `ActivityBadge.openLine` sends a terminal line to the Terminals page, and a command line to `drawer.openOutput` plus the Terminals page.
- **Grouping.** `ownerGroups` (`processLines.ts`) groups by owner: thread, operator, internal and archived.

## 4 Target model

- **The owner is renamed for what it is.** `ProcessesDrawer` becomes `ProcessesSection`, still project tier and still over the shared fold. It loses `open`, `toggle` and `hide`: a section is open while it is on screen. It keeps the filter, search, folds, output face and aim, so leaving and coming back finds it as left ([[59195588]]).
- **The page.** `ProcessesPage.svelte` is today's drawer body drawn as a page: a header with the counts and load, the filters and search, the grouped lines and the output face. The route `/[project]/processes` mounts it and answers `?thread=<id|operator>` with `jumpTo`.
- **Grouping by place.** The operator's lines are grouped per place by the record's `rootId` ([[e8d26502]]), named by the worktree listing's branch with its tone. A thread group carries its place's tone from the listing. A line with no place stays in its owner's group under no place heading.
- **Leading to owners.**
  - A terminal line opens `terminalHref(key)` ([[91f03b67]]).
  - A thread group's header links to `threadHref(thread)`.
  - A command line opens the output face in place.
- **Addresses.** `processesHref(thread)` addresses the section, and the `processes` surface joins `SURFACES` (primary, stands per project). `ActivityBadge.openLine` for a command sets the output face and goes to the section.
- **The status bar.** The standing chip's menu links to the section.

## 5 Owners and boundaries

- `features/terminals`: `ProcessesSection`, `ProcessesPage.svelte`, and the `ProcessLine`, `CommandOutput` and `processLines` it reuses;
- `routes/[project]/processes`;
- `features/workspace/address.ts`: the surface and `processesHref`;
- `features/harness/ActivityBadge.svelte` and `ThreadPeek.svelte`: the roads in;
- `features/frame/StandingChip.svelte`: the link.

The fold, its readings and the repository are unchanged.

## 6 Rejected

- **Keep the drawer as a strip under the terminal panel.** It would mix a place's terminals with the whole project's work, and it would stand only on Agents.
- **Put processes inside each thread's page.** The badge already shows one thread's slice. The project-wide view with operator and internal work needs a place of its own.

## 7 Acceptance

- The rail shows Processes and it opens the section.
- The badge's Processes link lands on the section with the thread's group unfolded and scrolled to.
- A command line opened from the badge shows its output face in the section.
- A terminal line in the section opens the panel on its place with the tab selected. Until [[91f03b67]] lands, it opens the Terminals page as today.
- The operator's shells in two worktrees stand under two place headings.
- The drawer's suites move with the owner. Suites that pinned the drawer's open/fold state die with it.

## 8 What becomes of what stands

- The drawer claims [[d970ca18]], [[8a1eb50c]], [[afd160ad]], [[59195588]], [[b0093c88]], [[d1a767ca]] and [[1641f184]] are rewritten for the section. [[afd160ad]] ("shut, the drawer is one band") dies: a section has no shut state.
- [[02352b2d]] is closed by this change: the page says what Enter does.
- [[da80d060]] survives.

## 9 Order

This lands after [[e8d26502]] and before [[91f03b67]].

1. The owner renamed and stripped of open/fold.
2. The page and route.
3. The addresses and the roads in.
4. The drawer removed from the Terminals page.

## 10 Contract

out: app addresses only. `?processes=` on the Terminals route leaves with that route, and `?thread=` addresses the section.

## 11 Stored data

out: the section's state is per project in memory, as the drawer's was.

## 12 Who may do what

out: stop and more-time go through the doors they use today ([[ae1095ed]], [[d3094c30]]).

## 13 Long-lived things

The section's owner lives in the project's scope. The feed subscription is watched only while the page is mounted ([[751118a9]]).

## 14 Bounded resources

out: the fold's windows and pages are unchanged ([[6cb16dfe]]).

## 15 Rollout

out: app only; a reload lands it.

## 16 Failures

The reading's own states are drawn as the drawer draws them: unavailable, host not answering, stale and partial ([[4b3f4d26]]).

## 17 Observability

out: the fold keeps its `tagma.command-fold` marks ([[6bc4898c]]).
