---
id: 01a10c9e-1497-7f48-93e7-bee087471ee2
title: Repeat push is suppressed by an hour-long push_sent mark, not by the event leaving "Attention"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/push/courier.ts
  - kind: file
    ref: apps/tagma/server/src/push/store/ledger.ts
---
Repeat push is suppressed by an hour-long `push_sent` mark, not by the event leaving "Attention".

Archiving and restoring a flow return the same ending, and a server restart and feed resync replay all of "Attention". The mark (subscription, subject — flow or notification, `eventId`) survives all of that, and redelivery only takes events younger than an hour, so the mark needs an hour of life. Age cleanup runs in the working server every 10 minutes.

There is no disk queue: offline, 429, and 5xx repeats live in memory. Before every attempt the courier checks that the event is still current for the flow and the subscription alive. So a question already answered and a revoked device get no new sends. A crash after the provider accepted but before the mark gives at most one repeat.

A subscription younger than the event does not get it, so a new device does not receive an avalanche of old ones.
