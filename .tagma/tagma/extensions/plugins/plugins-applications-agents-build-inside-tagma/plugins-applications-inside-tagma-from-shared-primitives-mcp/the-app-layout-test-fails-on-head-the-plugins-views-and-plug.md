---
id: 01a125c5-7447-7662-bbc6-ef1e4cee74f0
title: "The app layout test fails on HEAD: the plugins, views, and plugin-secrets zones off order, graph/sidebar unclassified"
ord: 12
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a1258b-4bed-7190-a24c-92dbc781ec39
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/layout.test.ts
---
`apps/tagma/app/src/lib/layout.test.ts` fails three tests and predates the [[c781ec39]] task's fixes: `ORDER` lacks the `plugins`, `views`, `plugin-secrets` zones; nine `features/graph/sidebar/` files stand in no `GRAPH_READS` surface; 68 imports go against the order, most of them `features/plugins` in `workspace`, `settings`, `threads`, `wire`, `shared`. The order is not fixed by appending: `threads/native/*.feed.svelte` imports `plugins/PluginView.svelte`, while `plugins/pluginHost.svelte.ts` imports `threads/presence`, so the `plugins` and `threads` zones reference each other.

The `projects` zone already stands in `ORDER` right after `threads`, `ProjectFocus` moved to `workspace`; lines like “`plugins/Sections.svelte.ts` (plugins) imports `workspace/Focus.svelte.js`” follow from the unclassified `plugins` zone.

Start with deciding where `views` and `plugins` stand relative to `threads` (a port `threads` declares and `plugins` fills, or moving plugin-view mounting to the `plugins` zone), then classify `graph/sidebar`. Done when `bun run --bun vitest run --project unit src/lib/layout.test.ts` in `apps/tagma/app` is green.
