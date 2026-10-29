---
id: 01a0cae0-193d-7795-b186-2b244ca6657a
title: "A layout act after a failed roster overwrites the stored tabs: persist re-arms in finally"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d56b-ca68-7171-9c36-241f3767a4d0",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/TerminalTabs.svelte.ts
---
`TerminalTabs` sets `loaded=true` in `finally` even when the roster read failed (`TerminalTabs.svelte.ts:739-742`), re-arming `persist()` (`:828-845`). The first layout act after a failed roster — and ⌘T works on the failed page — then overwrites the stored tab order, tabs and reopen stack with held-but-unrostered (effectively empty) state. A transient roster failure plus one keystroke wipes the persisted layout.

Do not persist until a roster has actually landed (or persist only the last good roster). Done when a failed roster can no longer clobber the stored tabs, with a test pinning the failed-roster-then-act sequence.