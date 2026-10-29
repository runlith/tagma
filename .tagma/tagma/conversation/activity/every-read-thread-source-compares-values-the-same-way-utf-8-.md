---
id: 01a11318-7f39-76a5-9fb3-ca6820f0347c
title: "Every read_thread source compares values the same way: UTF-8 byte order, Unicode case-insensitive contains, numeric path segment by value shape, groups by canonical JSON"
ord: 23
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/activity/src/store/document.ts
  - kind: file
    ref: packages/activity/src/store/query.ts
  - kind: file
    ref: packages/agent/src/thread/ThreadQuery.ts
---
A `read_thread` question means the same over the thread journal and over activity, although the first answers with an in-memory walk and the second with SQL in the store process. `queryConformance.stest.ts` asks both one question and compares the answers.

- **Text order is UTF-8 bytes.** That is BINARY order in SQLite. In the core it is given by `utf8Order`; `localeCompare` and JS string comparison over UTF-16 diverge from it on case and non-BMP chars.
- **`contains` over text ignores Unicode case.** SQLite's built-in `lower()` works on ASCII only, and `bun:sqlite` registers no custom functions. So the writer puts a lowercased-strings copy (`folded`) next to the document, but only if the document holds non-ASCII text. For ASCII, `lower()` suffices, and the copy does not double storage.
- **A path segment is chosen by value shape:** an array takes index `0` or a positive decimal without leading zeros, an object the key as written. SQL decides it at each step via `json_type`, because a static JSON path would have picked one thing in advance.
- **Groups are equal by value.** The writer writes documents canonically — keys in UTF-8 byte order — so SQL groups by JSON text the same way the core groups by `groupKey`. The natural group order is each group path's rank in turn, missing value last.
