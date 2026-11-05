---
id: 01a123c5-f783-7f18-b0c7-8ce2b7d795c0
title: "Stage 2 acceptance: a poker table with views — views/results/pins, a subscribed resource, player thoughts through tagma/thread, button moves"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1234b-6a18-72ce-a01b-55e251cd2681",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The first stage-2 accepter: the `.plugins/poker/` plugin gets a `table` view (ui/, live): the table, the person's cards, the pot, moves, and player “thoughts” (each player's text and run status through `tagma/thread`). The process serves table state as a resource, the view subscribes via `resources/subscribe` and reads with `resources/read`; the person moves with view-audience tool buttons (caller operator). Points: `views`, `results` (the open_table/table_status result draws the table in the ribbon), `pins` (pinned above the ribbon; until the manifest takes the point, pin with pin_view).

The spec's acceptance rule: only the plugin package's changes; when Tagma falls short, return the missing contract to its owner. Check: a live table on web and desktop on a separate instance, players on Muse; what is visible (frame descriptions) recorded in the finish.

## Acceptance result

Commit 38196f9e52, only the `.plugins/poker/` package: the `table` view (ui/table.html, table.css, table.js, live), the `views`, `results` (open_table, table_status), `pins` points; table state served by the process as the `poker://table/<id>` resource (public projection with no hole cards) and the `poker://tables` index, changes pushed as `notifications/resources/updated` in 100 ms batches; the person moves with `view`-audience `table_cards` and `table_play` buttons (caller operator, the move bound to the decision number). open_table pins the table above the calling thread's ribbon through `pin_view`.

What is visible live (web: Chrome against a separate instance on port 5953; desktop: an assembled Electron host with a deep link to the thread): above the ribbon the table pinned in a compact layout (oval, seats around, stacks, bets, D/SB/BB, the whose-turn highlight, the board, the pot); in the ribbon under the open_table call the same table in a full layout: the table, the player list with run status and text from `tagma/thread`, the hand's progress by streets, the last hand's result with open cards. At a table with a person: the person's cards, the Fold/Check-Call/Raise buttons (an amount field from min..max)/All-in enabled only on their turn, the table refreshes itself after a click; opponents' names do not open their threads and thoughts stay hidden while a game with a person runs. Thread rotation every 5 hands archives the old ones: 6 threads archived on the live table.

Sol xhigh review, one round, six findings, five fixed (hidden information in games with a person, binding the result to its own call, the move's decision number, several people at one table, geometry at 10 seats), the sixth returned to the bridge owner.

What the Tagma contract lacked: `tagma/thread` has no observation teardown, each observation lives until the view unmounts (their count grows with thread rotation); the pinned view's host reports `containerDimensions.maxHeight` as a window fraction rather than the pin region's true limit (a third of the height), so the view picks the compact layout on the pin key; the operator still sees opponents' threads in the shared thread list, and fair play with a person holds only inside the view itself.
