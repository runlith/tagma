---
id: 01a0f59b-35d4-752b-91c2-0fc0eb6b5286
title: A Svelte component reads a query through .data, .error and .isFetching, not through watch(), watchError() or watchFetching()
ord: 40
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/app
---
`watch*()` watches a cache entry without owning it: no observer opens, nothing fetches, and the entry may be collected. They serve feeds, badges, and guards that must stay free of the entry lifecycle. A component showing a query's value reads reactive getters (`.data`, `.error`, `.isFetching`): their first reader opens the observer, which fetches and holds the entry. A component never forces `refresh()` from an effect reading the same entry. Read the owning repo and its claims before writing against it.
