---
id: 01a11681-3d09-70d2-97f5-12e1e0d6c64f
title: "S6 server: holdings.subscribe and thread.changes channels, list-row totals, agent operations and contract texts (worktree changes-holdings)"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11742-4faf-72c4-808d-229c880821a9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1166f-7113-7752-b6b9-0a77762eb07f
  - kind: waits-on
    to: 01a11681-3d09-70d2-97f5-12dfb242b88b
---
Build the server part of [[762eb07f]] in the `changes-holdings` worktree on top of Holdings (S4).

**Includes:**
- **The `holdings.subscribe(checkout)` channel.** The first frame goes whole, then compressed changes: only the last `Holding` per path.
- **The `thread.changes(threadId)` channel** replacing `changes.subscribe` and `ThreadFileList`. Sections:
  - "Uncommitted" — without ignored;
  - "Could not verify";
  - "Outside git";
  - "Commits" — recomputed only on a HEAD shift or a new stamp;
  - reason totals.
- **The thread list row:** `held: {paths, unproven}` instead of `heldPaths`.
- **Operations:**
  - `read_changes {agent}` — the thread slice and per-turn history;
  - `read_changes {path}`;
  - `read_checkout` through `CheckoutHoldings`;
  - `read_authorship` on marks;
  - the `submit_work` answer with `committed`/`left`/`carried`/`owed`/`edited` fields;
  - `check_rules over: change`;
  - worktree archive;
  - `composeAgent` `written` — a query on the `(thread, path)` index.
- **Texts** from the [[762eb07f]] table: operation descriptions, doctrines, voice tools.

**Done when:**
- the server [[762eb07f]] acceptance passes;
- the wire types are fixed for the client (the S6 client awaits this task);
- typecheck, tests, and inspections are green;
- the change is committed to the branch.
