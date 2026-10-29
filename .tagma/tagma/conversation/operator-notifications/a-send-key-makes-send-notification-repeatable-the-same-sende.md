---
id: 01a12403-1625-7d82-b4a1-7f697dc2d2e6
title: "A send key makes send_notification repeatable: the same (sender, key) returns the earlier notification while its record lives"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/notify/store/ledger.ts
  - kind: file
    ref: apps/tagma/server/src/notify/store/tables.ts
---
A sender whose HTTP answer was lost doesn't know whether the notification landed; marking "sent" before the request would lose the notification itself. So sending takes an optional `key`, and the (sender, key) pair is unique at the table level: checking the existing record, the open limit and the insert run in one write unit, and the unique index holds the invariant even when the check misses. A repeat returns the first notification's id with `repeated: true`, doesn't change the recorded title and question, creates no row and publishes no event to the feed or push — even when the earlier notification already closed: an app must not get the question again after the operator answered.

A key lives exactly as long as the record: while the notification is open and a week past the outcome, then cleanup forgets it too. So a key doesn't serve as an eternal event id — a sender needing memory past a week keeps its own. Another sender's key is an independent space; with no key every send creates a new notification, as before (in SQLite NULLs in a unique index don't match).
