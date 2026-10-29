---
id: 01a1574c-e16b-7655-b920-2f9858c902ce
title: read_changes credits a peer's deletion of an app file to a session that never touched it
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "The path is judged 'deleted · this session · +0/−11 writing' under my session, which only edited other files with file tools and ran bun test/vitest/typecheck commands; a bare submit_work would have committed a peer's deletion under my task",
    "command": "read_changes (bare, session 01a1573b-bf1a-76ae-8b41-8f6db1b655a2) and read_changes path=apps/tagma/app/src/lib/app/panes/holder.ts",
    "expected": "holder.ts deletion attributed to the session refactoring apps/tagma/app/src/lib/app/panes (its sibling files are modified/deleted/untracked by that work), or to nobody"
  }
---
Filed from project `runlith`.

Seen in runlith main checkout on 2026-10-20 ~03:10Z. My commands in that window: `bun run typecheck` (server), `bun test` on server tests, `bun run --bun vitest run --project unit src/lib/features/checkout/CheckoutPage.svelte.test.ts` in apps/tagma/app. None deletes source files. The same directory shows a peer's in-flight refactor: `D DockedArea.svelte`, `D PaneKinds.ts`, `?? PaneRegistry.ts`, several `M`, and HEAD 245167c0b6 last touched holder.ts. The other paths of that refactor are not credited to me — only holder.ts. Workaround: submit_work with explicit paths excluding holder.ts.