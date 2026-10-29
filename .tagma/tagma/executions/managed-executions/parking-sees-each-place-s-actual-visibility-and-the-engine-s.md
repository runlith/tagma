---
id: 01a15cbb-acdf-77f0-b9fd-40a28106944d
title: "Parking sees each place's actual visibility and the engine's real cost: off-screen built-in terminals park, the budget holds"
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15cb6-19e9-7695-ad3b-1fdda43f4d31",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15c5c-d764-7aca-9b65-9090251c93cd
---
Found by the [[251c93cd]] delivery review:
- built-in terminals (`TerminalViews`) always count as visible: feed cards in overscan off-screen and threads on the right hidden by attribute with `keep: true` hold engines, subscriptions and observers and bypass parking;
- `heldBytes` counts only cell arrays, without combined, extended attrs and references;
- hidden engines are not narrowed when scrollback or the grid grows;
- a pane's `dispose` from `TerminalViews` does not unregister it from hidden GPU owners, and closed panes stay reachable;
- `Views` does not cut the held count down to HELD after leases are freed;
- the parking and reopen contract is not protected by an owner test, while `Output.test.ts` pins the point-record form.
