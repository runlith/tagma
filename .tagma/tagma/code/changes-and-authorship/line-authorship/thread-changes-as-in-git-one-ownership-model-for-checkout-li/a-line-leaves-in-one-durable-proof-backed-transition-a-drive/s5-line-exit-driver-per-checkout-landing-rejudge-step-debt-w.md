---
id: 01a11681-3d09-70d2-97f5-12e0368b0def
title: "S5: line exit driver per checkout, landing rejudge, step debt (worktree changes-holdings)"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11742-4fac-73b3-a36c-0ac3c1b269a4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1166f-7113-7752-b6b9-0a765fa48d08
  - kind: waits-on
    to: 01a11681-3d09-70d2-97f5-12dfb242b88b
---
Build [[5fa48d08]] in the `changes-holdings` worktree on top of Holdings (S4).

**Includes:**
- **An exit driver on every checkout with held lines**, with no graph link:
  - durable `seen` and a `(seen, HEAD]` pass with one `git log --format='%H %P' --name-only`;
  - guards: `writing`, the thread's open command window, fingerprint reconciliation before transition.
- **Transitions and I7:**
  - "carries" on the diff against the first parent;
  - for a landing — on the pre-step tree recorded as a landing fact;
  - for a file judged whole — on the blob.
- **Resulting states:** `overwritten` and `reverted`. `reverted` becomes durable on any HEAD shift, `overwritten` when the overwriter leaves. Plus `released`.
- **Landing** (`landing/land/submit.ts`, `commit_checkout`):
  - path leasing;
  - rejudge and pass on its own commit instead of a planned stamp;
  - `withdrawn{formed}` instead of an `emptied.base` commit;
  - reshape inputs read before publishing, else a `reshape-unreadable` refusal;
  - reshape is all-or-nothing per file;
  - step debt is a durable fact, `nobody: steps{C}`, `owed` in the answer;
  - `committing.left` stays held by the session;
  - `post-commit` is a debt too.
- **Debt cleared by the driver:** windows with no held lines, no running turn, and no command window are replaced with HEAD text through CAS.
- **Thread-deletion subscription**, pass at startup, `checkout-gone` on worktree archive.
- **Root-registry healing** never downroots a root with held record lines. This is a workspace port the change record fills.
- **Delete:** all of `record/discharge.ts`, `stampTransformed`, the planned stamp, the discharge subscription to `ServedMirrors`, `withdrawVanished` from reading.

**Done when:**
- the [[5fa48d08]] acceptance passes through public operations in tests;
- typecheck, tests, and inspections are green;
- the change is committed to the branch.
