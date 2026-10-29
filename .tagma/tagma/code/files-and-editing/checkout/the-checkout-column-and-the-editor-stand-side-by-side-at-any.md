---
id: 01a17ea8-ed9f-724b-9732-678dba2e90a2
title: "The Checkout column and the editor stand side by side at any window width: the two-screen narrow mode is removed"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ea9-9a47-78c1-8434-854a22de8156",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17ea8-dfa1-7b94-bcf8-207eaab69873
  - kind: relates
    to: 01a15ae1-974d-77c6-8b35-2408e7449703
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CheckoutPage.svelte
---
At just 900 px the Checkout column becomes a second screen on its own: `CheckoutPage.svelte` (`DRILL_BELOW`) stretches the column full width and covers it with the editor when a tab is open, and tabs get a "back" button instead of close. This breaks [[e7449703]]: only the user changes the layout, panes stay in place and only resize. The closed spec [[b51edd1b]] decision on two screens is lifted by this law. The phone shell does not need it: Checkout is not shown on the phone (`surfaces`, `phone`).

Column and editor stand side by side at any window width, the seam holding the column within its bounds. Found while taking apart the worktree board.
