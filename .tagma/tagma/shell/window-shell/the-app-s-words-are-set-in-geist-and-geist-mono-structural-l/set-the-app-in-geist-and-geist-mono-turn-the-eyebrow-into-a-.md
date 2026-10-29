---
id: 01a0d121-6bad-791f-a43f-2d44148cdcd4
title: Set the app in Geist and Geist Mono, turn the eyebrow into a sentence-case label, and keep Archivo on the nameplate alone
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d121-c3b6-778d-9bce-73a3a13f0dd0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d121-2eb5-7303-b5ab-66c63734162e
---
Build [[3734162e]] as the decision states it.

- **Start at** `apps/tagma/app/src/app.css`: the three `@fontsource-variable` imports, the `--font-*` tokens, and the `eyebrow`, `stamp` and `label-lift` utilities. Add `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` to `apps/tagma/app/package.json`.
- **Then** every direct `font-display` use and the nameplate in `frame/TopBar.svelte`, then the hard-coded canvas families in `graph/spatial/GraphView.svelte` and `graph/spatial/MindMap.svelte`.
- **Leave alone** the terminal's own font setting (`terminals/terminalEngine.ts`).

**Done when:**
- the decision's acceptance holds, checked in a browser;
- the app typecheck and tests pass;
- [[27e9430f]] and [[5997d591]] are reconciled as the decision's point 8 says;
- the decision is closed naming the claims that now carry it.
