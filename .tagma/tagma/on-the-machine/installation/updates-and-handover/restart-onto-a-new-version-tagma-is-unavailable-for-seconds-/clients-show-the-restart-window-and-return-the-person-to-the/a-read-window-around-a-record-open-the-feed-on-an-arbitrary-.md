---
id: 01a126e2-737d-7034-bd51-371da41aded8
title: "A read window around a record: open the feed on an arbitrary record without scrolling from the tail"
ord: 6
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a126df-ec0c-72df-9860-24c70707eeba
---
The feed today knows only the tail and the pages before it: `thread.subscribe` returns a snapshot of the newest records and a `before` cursor, `thread.entries({before})` returns the page before an ordinal number, and a record on the wire has no ordinal number. So a record deep in history can only be reached by scrolling from the tail, and the cost grows with the distance. Returning the place after reload ([[0707eeba]]) scrolls within a budget and stays at the tail past it.

A real window is two things. On the server: reading the page that ends at the named record (finding the ordinal by record identity; for an unloaded thread today that is a rollout scan). On the client: a mode in which `ChatFold` holds a segment detached from the live tail and can return to the tail; today the fold is one continuous range to the tail and only grows forward.

The same window is needed not only for returning the place: for jumping to a message from search and for a record link.

What is unknown: how much finding the number by record costs for an unloaded thread, and whether it is simpler to put the number into the record on the wire.
