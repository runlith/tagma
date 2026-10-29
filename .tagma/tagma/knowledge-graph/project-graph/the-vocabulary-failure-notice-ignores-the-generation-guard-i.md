---
id: 01a0caba-3b2a-7c01-a253-01d6b0c37a48
title: The vocabulary failure notice ignores the generation guard its three siblings keep
ord: 5
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/journal/JournalScreen.svelte.ts
---
`JournalScreen` guards three of its four failure notices on the reading generation — `readOlder` (`:199`), `prime` (`:226`), `refresh` (`:242`) all report only `if (current === this.generation)` — but the `loadVocabulary` catch (`:257-259`) reports unconditionally. A vocabulary read that fails after the scope or filter moved raises a refusal notice for a reading no longer on screen, with no comment justifying the difference.

Guard it like its siblings. Done when a stale vocabulary failure stays silent and a current one still reports, with a test pinning the stale case.