---
id: 01a0cb44-3b4b-7cad-a56f-306971444243
title: The Amend item is live with nothing staged and its press does nothing
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cff3-9abb-7fb8-888c-f68f0a033726",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CheckoutPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitBox.svelte
---
`CommitBox.svelte:59` enables "Amend last" on `disabled={message.trim() === ''}` alone, while `ready` (`:22`) also requires `staged > 0` and `commit()` (`:25`) early-returns on `!ready`. With a message typed and nothing staged, the item is live and its press does nothing at all — no dialog, no notice, nothing cleared. The zone's own conventions say the opposite twice: the Commit button and "Commit and push" are disabled on `!ready` (`:45,:58`), verified claim [[d9f2858f]] says a commit press needs a message and something staged, and [[56e35de8]] makes a control that can do nothing absent rather than dead. The door permits the missing case (`checkout_commit`'s declared refusals are PLACE, MOVED, GIT — no nothing-staged arm; `amend` is the act's own parameter).

One of the two must move: the item's `disabled` to `!ready`, or the guard to admit an amend with an empty index (an amend of the message alone is a real git operation). Done when the offered press either acts or is absent.