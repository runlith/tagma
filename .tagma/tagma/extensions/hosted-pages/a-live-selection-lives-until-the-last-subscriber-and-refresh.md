---
id: 01a15167-c0e2-729c-94c1-7a1a1e95c16b
title: A live selection lives until the last subscriber and refreshes on the published ready record
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/artifacts/selection.ts
  - kind: symbol
    ref: apps/tagma/server/src/artifacts/shelf.ts
    symbol: versionedShelf
---
The same ordered thread set and limit share one active selection: the first subscription reads the pages, the last frees the projection in the worker and the answer channel. Thread order matters because it sets a shared page's owner and the order at equal publish times. The projection holds membership and the candidates' current records, so a publication refreshes only one record, keeping the exact total and top-k with no re-reading of unchanged pages. A page republished outside the team refreshes too if it already belongs to the selection. Owner closing covers subscriptions still awaiting the first answer. Worker loss or an unhandled storage failure terminates its subscriptions: the publication may have already changed current, so the old projection must not keep serving. A new subscription builds from storage.
