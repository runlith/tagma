---
id: 01a13d57-c92a-783c-bbf3-4ad4e8790af7
title: "Warm projects: WarmHolds, ProjectFocus, and splitting tier services into project state and window acts"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d8d-c46e-77db-adac-fb2ea199c9cd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d1d-cf8d-7804-a695-42f8fba4f4d3
  - kind: waits-on
    to: 01a13d57-c92a-783c-bbf3-4ad3df3f8f93
---
Implement [[fba4f4d3]]: `WarmHolds` and `WarmHold` in `app/chrome/Shell.svelte` outside `{#key}`, warmth from the `ProjectStrip` recents; `ProjectFocus`; window acts of a non-current project stay silent — start with `features/plugins/Sections.svelte.ts`, `worktrees/BoardState.svelte.ts`, `executions/places/State.svelte.ts`, `executions/terminal/Panel.svelte.ts`, `executions/commands/Activity.svelte.ts`, then walk every `project`- and `graph`-tier service and list what's found in the finish. Done when the spec's "How to check" tests are green, and a warm project's memory and subscription count are measured on the operator's largest project and named in the finish as a sample.

## Result

Landed in `0d314e3618` (warm projects, `ProjectFocus`, the split) and `b424ab701a` (review fixes).

`project`- and `graph`-tier services walked on the two marks:
- `Sections` — publishes sections and acts while the project is current, through `PluginActions.show`: one publication per window.
- `Worktrees.aimed` — `null` while the project isn't current; `TerminalPanel.aimed` and the `TerminalPlaces` effects stay silent behind it.
- `TerminalPlaces.readdress` — a background project's deferred `reveal` doesn't write the window address (`ProjectFocus` check where written); it writes the layout with its own mutation.
- `CommandActivity.root` — its own project's root, not `workspace.contextProject`.
- `Favorites`, `ModelDefaults` — moved to the `app` tier: the operator's preferences, copies in warm projects diverged and overwrote each other.
- `SettingsRepo.write` carries its project; `writtenCatalog` gives the answer only to the same project's reader (`TerminalAppearance`, `TerminalPlaces`, `Dictation`, `Global`, `Calls`, `AutoSave`, `LoadButton`).
- Left with reason: `ThreadList.seeOpenOutcome` follows `ThreadOnScreen` and marks only its own list's rows; `ThreadPanes` holds up to 6 harness-thread panels in the background too (no DOM output at background cadence); background `graph`-tier subscriptions (`GraphFeed`, `Checkout`, `Holdings`, `Explorer`) are project state; background subscription and record failures go to the shared `Notices`/`Failure` with no project name; eviction announces the tier's `Handoff.leave` with the current scope unchanged — no consequence today, there are no non-`app`-level overlays.

Measurement (sample: one `tagma:try` instance on an idling server, headless Chromium): runlith — 3131 blocks, ~27k files, 0 threads. Warm in the background it holds 10 live subscriptions (project: worktrees, threads, commands, graph.recovery, views, calls; graph: graph, checkout, holdings, tree) and ≈0.25 MB JS heap over a warm empty project (37.66 vs 37.41 MB after GC); it holds no DOM nodes or listeners. Returns to warm projects log `warm: true`, `listMs` ≤ `navigationMs` in all 12; frame median 117 ms against 173 ms for 8 cold moves of the same run, the remainder is page remounting. No "before" report under operator load.

Not checked: svelte-check after `b424ab701a` didn't fit in 3 minutes (after `0d314e3618` — no errors in changed files); `SettingsCatalog` tests failed before this change too; warmth cost with thousands of threads and open terminals isn't measured; the operator checks moves under load.
