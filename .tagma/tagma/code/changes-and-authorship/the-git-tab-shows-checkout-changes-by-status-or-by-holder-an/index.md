---
id: 01a14c13-c481-7acc-8aa6-03bd4ccde6e8
title: The Git tab shows checkout changes by status or by holder and offers stage, unstage, and discard
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2aaba2d4d54
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b58c7d795b
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03bfd37a7e83
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c0e4e2e9fe
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c14b093139
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CheckoutTenant.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/GitView.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/threadGroups.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/contract/wire/checkoutActs.ts
    symbol: CHECKOUT_ACT_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/workspace/contract/wire/checkoutReads.ts
    symbol: CHECKOUT_OPERATIONS
---
**Value.** The operator sees the branch state and every changed path where they work with code, and sorts changes by who wrote them.

**How.** The Git column on the Checkout page (Cmd+Shift+G); the checkout segment in the status bar with files, lines, and ↑/↓; the `read_checkout`, `stage_checkout`, `unstage_checkout`, `discard_checkout` operations. The agent reads the same `read_checkout`.

**Behaviour.**
- The header is the branch with ↑/↓ against upstream and a comparison-base picker: upstream or any project branch; the comparison shows files and lines against that base.
- Changes group by status (Conflicts, Staged, Changes) or by holder: "Your changes", each thread, "Other changes" for nobody's. A row opens a diff preview tab, double-click a pinned one.
- Stage and unstage work by path or by section. Discard writes a tracked path from the index and deletes an untracked one — after confirmation with the path list, no way back.
- Under the commit button, threads still writing in the checkout are named with a link to them. The project graph stands as a separate collapsed section with Sync (graph sync — A4).
- The checkout row is held by the server and re-read by tree mark, so a repeated request costs no git; a stale row is marked and re-read by click.

**Limits.** A path in the graph store is neither staged nor discarded. Discard on a stale read refuses. Nothing is stashed.
