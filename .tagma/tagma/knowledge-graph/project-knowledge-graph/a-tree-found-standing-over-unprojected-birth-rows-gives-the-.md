---
id: 01a1a1ac-a5ec-7654-a490-3fd4f0515246
title: A tree found standing over unprojected birth rows gives the project its catalogs, once
ord: 270
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1a19e-955c-7ece-a9f7-f89859f041a7
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: switchIfDue
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/birth.ts
    symbol: adoptCatalogs
---
The switch answers `adopted` when it retires birth rows that were never projected because the tree already held blocks — a carried `.tagma` in a clone, or a stealth tree the exchange side brought from a remote. That opening writes the catalogs installed in the found tree as the project's pinned `graph.catalogs` layer before the mirror installer runs. Without it the installer would read the creation's choice or the machine default and install it into a graph someone else made: on a team graph that lands in every teammate's checkout through the next commit.

A found tree carrying no catalog declaration at all — written by hand or before catalogs existed — made no choice, so nothing is adopted and the installer applies the project's or the machine's choice as for any graph. It happens once: the rows are retired in the same act, so a later opening answers `standing`, and a rebuilt mirror never re-adopts — re-adopting would switch back on a catalog the operator switched off, whose declaration nodes stay standing.
