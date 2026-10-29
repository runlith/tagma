---
id: 01a0d980-975d-7b73-bef5-a03a44157e29
title: "`/compact` offers the choice read as options with the resolved summarizer preselected; the thread card, the feed entry and the settings chain show who compacts and whose quota pays"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d9d0-b0bc-7874-a512-cfdab6a74026",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d980-451f-7376-b8a0-a342478a03df
  - kind: waits-on
    to: 01a0d980-79cc-7222-9327-daa9fce8a039
---
Implements the Surface part of [[478a03df]] (§4 Surface, acceptance 8), over the choice read the backend task lands.

- `/compact` in `apps/tagma/app/src/lib/features/harness/HarnessHost.svelte.ts` gains options from the choice read: the resolved default first and preselected, then the chain with each member's spendability and until-when, the thread's own model, and the rest of the catalog. Every row shows its estimate, passes and whose quota pays. Enter on the default compacts exactly as today, and Tab keeps queueing after the run. The command's `value` names who will compact, or "no summarizer".
- The thread card (`ThreadPeek`) of a cold, large thread offers "Compact · <resolved model>" and "Another model…".
- The feed's compaction entry names the summarizer, its quota and skipped members.
- The settings section renders the rule and the ordered chain from their declarations, each member with its live spendability.

The agreed look is the page at http://localhost:5634/a/84cca7c161ed, with one command instead of two. Load the `svelte5` skill before writing Svelte.

Done when acceptance 8 holds in the running app, the surface claims touched are rewritten from the code and verified, and the change is committed.