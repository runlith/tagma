---
id: 01a11681-3d09-70d2-97f5-12e2d50da88f
title: "S6 client: ThreadChanges and Holdings stores, Changes panel, badge, status bar, Git tab (worktree changes-holdings)"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a117b5-09be-792b-b46d-709d545b49cc",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1166f-7113-7752-b6b9-0a77762eb07f
  - kind: waits-on
    to: 01a11681-3d09-70d2-97f5-12e1e0d6c64f
---
Build the client part of [[762eb07f]] in the `changes-holdings` worktree on the server part's channels. Only Sonnet and Opus write UI (73ef5889); the standard tokens are 55b5437b.

**Includes:**
- **Stores.** `ThreadChanges` (thread tier) on `thread.changes` and `Holdings` (graph tier) on `holdings.subscribe`. They apply changes and never derive ownership.
- **Changes panel:**
  - sections "Uncommitted" (checkout groups), "Could not verify", "Outside git", "Commits", "How lines ended";
  - a line shows the thread's own `+/−`, the git letter, who else holds lines in the file;
  - empty only on `current` with zero; on `stale` the last list, the reason, and "Retry"; before the first frame — nothing.
- **Sidebar badge and panel button** — `held.paths`, with "+k?" on unproven, plus a hint.
- **Status bar** — Holdings totals: "N changes · N unowned · N unverified". While the Holdings revision lags the checkout line — an "updating" mark.
- **Git tab** — holders and nobody lines from Holdings, "Group by thread" on `hands`, an "updating" mark.
- **Delete:** `ThreadFiles.svelte.ts` in its old form and the `heldPaths` read.

**Done when:**
- the client [[762eb07f]] acceptance (today's 30/30/30/"45 · 15 unowned" scenario, the unproven path, two groups, `stale`) is verified in a browser on the dev stand;
- svelte tests are green (contracts only, not layout);
- the change is committed to the branch.
