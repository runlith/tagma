---
id: 01a14c13-c481-7acc-8aa6-03c98a57314e
title: A worktree creation whose end nobody saw is recovered or released without touching files
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/worktrees/creation/recovery.ts
  - kind: symbol
    ref: apps/tagma/server/src/worktrees/contract/wire/operations/creation.ts
    symbol: CREATION_OPERATIONS
---
**Value.** An interruption in the middle of worktree creation — a restart, a killed process, a hook that cleaned up after itself — neither locks the name and branch forever nor risks a live checkout.

**How.** An agent with the worktrees capability, or `tagma op`: `read_worktree_operation`; `prepare_worktree_recovery` and `adopt_worktree`; `abandon_worktree`; `reconcile_worktree`.

**Behaviour.**
- Reading answers how far creation got, plus the receipt — what ran, how git ended, what stood in place and in storage — if the server saw the end.
- Adoption takes the leftover checkout only by proving it: that it is the reserved place, the same object the permission named, and that git reads it as a checkout of this storage. Root registration and closing the creation go in a single act.
- Release drops the name and ref from the creation only with a receipt; without one the creation stands until it is proven there is no writer. Reconciliation writes the receipt from the current state only if another Tagma installation approved the creation.
- None of these acts moves, writes, or deletes files.

**Limits.** Recovery has no screen: on an unclear outcome the app only names these operations to the operator in text.
