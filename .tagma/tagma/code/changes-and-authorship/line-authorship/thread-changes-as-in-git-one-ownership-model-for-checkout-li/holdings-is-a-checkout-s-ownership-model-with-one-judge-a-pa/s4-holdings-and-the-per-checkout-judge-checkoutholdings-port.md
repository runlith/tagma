---
id: 01a11681-3d09-70d2-97f5-12dfb242b88b
title: "S4: Holdings and the per-checkout judge, CheckoutHoldings port, failure as data (worktree changes-holdings)"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11742-4faf-72c4-808d-229c880821a9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1166f-7113-7752-b6b9-0a75fe04fc30
  - kind: waits-on
    to: 01a11681-3d09-70d2-97f5-12e376c9db4f
---
Build [[fe04fc30]] in the `changes-holdings` worktree on top of the folding (S3) and the new intake (S2, the `changes-intake` branch already merged to main and pulled into this branch).

**Includes:**
- **The `Holdings` model** per checkout:
  - domain — held paths, plus dirty ones when subscribed;
  - `Holding`: `proven{hands, nobody}` | `unknown`;
  - totals counted incrementally.
- **Judge:**
  - single-flight per path, the request lane ahead of the background, path leasing by the landing;
  - the [[fe04fc30]] input fingerprint, rejudge only on its change;
  - shifts arriving from intake, the checkout line, HEAD, and thread records;
  - lifetime and cold start as in [[fe04fc30]].
- **The `CheckoutHoldings` port** in workspace instead of `CheckoutHolders` and `CheckoutWriters`. `holding()` leaves the checkout line's build.
- **Failure as data.** Three read states, `unknown` per path or per batch, one log. `platform/rereading.ts` drops `reading` on any outcome.
- **Policies.** ignored, archived, failed is a live holder, deleted thread, rename, unmerged, several checkouts.
- **Connecting the folding and deleting the old:** `HeldCounts`, `HeldPaths`, `threadFiles/listing` (weighing), `weigh.ts`, `holding.ts`, `frontier.ts holdersOf`, `attribution.ts`, `replay.ts`, `revert.ts` in the old form.

**Done when:**
- the [[fe04fc30]] acceptance passes, including the I3 property test;
- typecheck, tests, and inspections are green;
- the change is committed to the branch.

The channels for surfaces and the exit driver are not this task's to build.
