---
id: 01a1322a-22fd-7d53-8112-4b43352e58d6
title: Checkout marks change Holdings inputs; a checkout line changes its dirty domain
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judge.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judges.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/paths.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/serving.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
    symbol: probeAt
---
Checkout marks change Holdings inputs; a checkout line changes its dirty domain.

A mark may name a directory: its scope covers already-judged and current descendant paths, including recorded ignored paths missing from git status. With readable HEAD and Git listings, a path absent from HEAD enters the unrecorded candidate domain only when Git lists it among the checkout's indexed or non-ignored files. This lookup stays scoped to the named candidates even when their pathspec needs several command lines. Watcher events can name ignored content or submodule descendants; neither becomes an untracked parent file. Recorded files absent from that Git domain keep their authorship in Outside git. An unread listing or HEAD preserves uncertainty instead of proving a path absent. An explicit preview/rollback entry reads through completed records. The descendant index lives with the judge's entries and releases once the path leaves; a local file mark never scans the whole domain. A new checkout line adds and removes dirty paths, and already-visible paths' entries shift marks and HEAD: re-expanding a local mark to every dirty path would repeat the probe. An observer mark never opens a missing judge; a line write opens it through its own road.
