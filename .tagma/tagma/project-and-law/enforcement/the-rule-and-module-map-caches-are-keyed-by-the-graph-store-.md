---
id: 01a1b287-27fa-72bc-a87c-07c4bc5a9488
title: The rule and module-map caches are keyed by the graph store's own commit count, never by a read of the journal
ord: 179
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/contract/service/ruleRevision.ts
    symbol: storeRevision
---
The statutes and module map a judgement reads are cached per graph store under a stamp; the stamp must move, in this process, before any act that committed a card or rule write returns to its caller. The store's `TableMoves` counts every committed unit right after its COMMIT, so a landing that follows `set_module` always misses the entry the old cards made and reads the cards again.

A stamp read from the database — the newest journal event, read on a reader connection while the cards are read on the writer — is tied to no write its caller was already answered about; when it names the state before that write, the cache hands back the map the write replaced, and a landing refuses a relation the card already carries until some later write moves the stamp. Inside an open act the stamp is absent: reads there see uncommitted rows, which must not be kept.

The count moves only for writes made through the store's units in this process: a raw write through `store.db` outside a unit leaves both caches stale until the next unit commits.