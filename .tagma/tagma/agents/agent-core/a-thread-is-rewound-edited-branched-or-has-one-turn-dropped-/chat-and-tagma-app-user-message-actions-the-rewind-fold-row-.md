---
id: 01a0f262-57a0-7d40-9616-795aa5ee40b5
title: "Chat and Tagma app: user-message actions, the rewind fold row, the dropped-turn line, the composer chip, the Esc-Esc picker, the refusal banner and the confirmation popover"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f263-5e7f-7bdc-ab9f-06e1eaa4a32e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f262-03db-7bb1-84f3-665d4263865b
  - kind: waits-on
    to: 01a0f262-5685-7e97-b058-bd0ba1b50e86
---
Build §4.6. `packages/chat-ui`: the rewind mark on `ChatEntry`, the timeline grouping rewound entries into one fold row (Show / Hide / Restore) and a dropped turn into one struck line, the user-row action bar in `MessageMeta` (Edit, Rewind here, Branch, Drop turn; hover and focus), the composer chip `↶ rewound to message N` whose × restores, the double-Esc picker and ↑-to-edit — all product-free, reaching the product through callbacks. `apps/tagma/app`: wiring the four operations, the ending banner for `retryable === false` (primary Rewind N failed turns, Change model…, Continue as ghost), the confirmation popover from `read_rewind` only when more than words stand, with revert-lines off by default. The design reference is the published artifact "Отмотка треда".

Waits on the kernel task's wire contract; the operations wiring waits on the server task.

Done when acceptance criteria 1, 4 (picker) and 9 hold in the app, with chat-ui tests over the fold grouping and the action callbacks.