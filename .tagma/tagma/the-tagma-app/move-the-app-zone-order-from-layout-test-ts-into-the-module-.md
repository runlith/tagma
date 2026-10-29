---
id: 01a14c15-d069-7e86-a122-e5f7470c989b
title: Move the app zone order from layout.test.ts into the module law or an enforced check
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a174a1-7f69-752f-8032-e98b87c8f3bc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14b32-e550-77d4-9966-60fae9dc9939
  - kind: relates
    to: 01a125c5-7447-7662-bbc6-ef1e4cee74f0
---
Move the app-zone order check from the deleted `apps/tagma/app/src/lib/layout.test.ts` into the law: `#module` cards through `set_module` or an enforced check, the implementer chooses after reading the affected boundaries. The test checked no public runtime contract of its own and read the disk in the unit tier; its removal does not prove the app imports correct. There are no `#module` cards covering the `app/src/lib/features` zone order now, so the current import check does not replace that order.

The old `ORDER` (bottom up): `shared`, `wire`, `workspace`, `notices`, `opening`, `settings`, `activity`, `shell`, `power`, `devices`, `graph`, `rules`, `speech`, `providers`, `mcp`, `telemetry`, `worktrees`, `executions`, `threads`, `projects`, `pages`, `browser`, `checkout`, `palette`, `app`. The old `GRAPH_READS`: `outline: []`, `spatial: []`, `journal: []`, `block: ['outline', 'journal']`. The shared `graph` part could import the surface only in `*.layer.ts`/`layer.ts` composition; the surface could read the shared part. This is input data for a boundary check over the current code, not already accepted module cards.

On main 2026-10-17 the test found four zones outside `ORDER`: `access`, `plugins`, `views`, `plugin-secrets`. Nine `features/graph/sidebar` files outside `GRAPH_READS`: `SidebarRow.svelte`, `seams.ts`, `treeLines.ts`, `Sidebar.svelte.ts`, `SidebarTree.svelte.ts`, `SidebarShelf.svelte`, `Sidebar.svelte`, `SidebarHeading.svelte`, `SidebarTree.svelte`.

The third check produced 98 messages: e.g. `settings/controls/CatalogPicker.svelte` → `providers/Catalog.svelte.js`, `workspace/ShellOps.ts` → `notices/Service.svelte.js`, `executions/terminal/Pane.svelte.ts` → `browser/Links.svelte.js`, `browser/Links.svelte.ts` → `app/panes/SidePanes.svelte.js`, unclassified `graph/sidebar` imports. Among the messages are imports of unclassified zones whose index the check counted as `-1`; the number 98 is not a proven count of architecture defects. The previous layout task also recorded mutual `plugins`↔`threads` references.

On 2026-10-25 the operator widened the task. The app law must match the server law ([[4ca65e0d]]): `#module` cards for every app part, every server check whose subject exists in the app judges the app too, and not a single cycle. The found opening↔checkout cycle passed right here.

Done when the current zone boundaries and allowed dependencies are set at the law's owner, the check runs by the declared mechanism and names real violations; fixes for the found violations go to their owners. The test's arbitrary order is not restored by a mass re-cut of the app.
