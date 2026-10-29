---
id: 01a13292-a115-76da-af84-5bdab8a3738b
title: Operation texts, display, and status menu speak contract meaning, not task words
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What changes

Operation texts, display, and menus speak the meaning of the contract, not of one catalog. Operation names and refusal codes are [[c3ad3db4]]; below, operations are named by their current names.

- `finish_block`: "End a node at its tag's done word: the work it stood for happened." Display "Finishing" / "Finished".
- `close_block`: "End a node at its tag's closed word: dropped, answered elsewhere, or a spec accepted or no longer wanted." Display "Closing" / "Closed", confirmation question — "Close X?" with a reason. The target word is not part of the question: confirmation sees only the input, and reading the node for the question is an extra dependency.
- `claim_task`: "Take a node whose tag binds a holder: move it to its claimed word and sign this session in." `release_task`: "Give a held node back: its initial word, no holder."
- `link_blocks`: For "waits-on": "the work that waits", without "task".
- `create_block`: without "with provenance"; `accept_proposal`: "Created blocks link back with discovered-from" stays true after [[26568d3b]].
- Holding facts (`heldFacts` in `operations/work.ts`) speak the tag's word, not "open" and "not done".
- App: the status menu and `restingState` (`TagCatalog.svelte.ts`) take the turn label from the turn meaning in the projection [[36632cde]] — "Take", "Give back", "Finish", "Close", "Reopen", "Move to <word>" — not "Start work" / "Close as not needed".

## Verification

App: the menu-owner unit — for a spec the close item exists and its turn leads to the `closed` word; for a custom tag with a holder the take and give-back items exist — turns are compared, not labels. The operator sees "Closed" for an accepted spec in the feed.
