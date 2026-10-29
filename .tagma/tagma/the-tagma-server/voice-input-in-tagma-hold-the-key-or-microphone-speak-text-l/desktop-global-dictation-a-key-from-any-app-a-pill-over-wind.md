---
id: 01a10b71-fa9b-7114-9169-1500317e9f52
title: "Desktop: global dictation — a key from any app, a pill over windows, and insertion into focus via `desktop-input`"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10b70-624a-788b-ba2a-cbe616b50a26
  - kind: waits-on
    to: 01a10b71-faba-7e56-8109-21ae08141b1a
sources:
  - kind: dir
    ref: apps/tagma/desktop/src
---
Step 3 of the spec, the "Desktop" section. Follows step 1, because the pill reuses the window `Dictation`. Start with `apps/tagma/desktop/src/main.ts` and `packages/desktop-input`. Done when a smoke of the installed `Tagma.app` inserts text into Notes, and Accessibility survives a rebuild.
