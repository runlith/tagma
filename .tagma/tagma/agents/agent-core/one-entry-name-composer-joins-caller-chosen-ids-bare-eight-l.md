---
id: 01a0c9ab-2a2d-72df-ab6e-401b0bd39a8f
title: One entry-name composer joins caller-chosen ids bare, eight lines below the comment condemning exactly that
ord: 128
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/transcript/entryNames.ts
    symbol: questionEntryId
  - kind: symbol
    ref: packages/agent/src/transcript/entryNames.ts
    symbol: readyAnswersEntryId
---
Entry names are built from ids a caller chose, so a name that joins two of them with a separator can spell one string for two different pairs. The file says so itself, above `questionEntryId`: run and call ids are caller-chosen strings, a bare join makes `('a', ['b','c'])` and `('a:b', ['c'])` one name, and two questions' facts collapse into one row. That function carries the remedy — every segment prefixed with its own length, so each pair spells one name and each name spells one pair.

`readyAnswersEntryId`, eight lines below, joins its run and call ids bare. It composes the same kind of pair from the same kind of caller-chosen strings and does exactly what the comment above it condemns. Two rows that should be distinct can take one name, and the fold that places entries by id would keep one where there were two.

The ordinal names have a thinner version of the same gap: the zero case is written bare and later indices are suffixed, so a name built for index zero of one identity can equal a name built for a later index of another. Both are theoretical against uuid-shaped run ids and provider-shaped call ids, and neither is reachable by anything a model writes. That is why this is worth fixing rather than urgent — the collision needs an id containing the separator, which today's minters do not produce.

What makes it worth a task anyway is that the reasoning is already written down and already applied once. A reader of this file learns the rule from the comment, sees it kept immediately above, and will not suspect the function immediately below of breaking it. The asymmetry is the defect more than the collision is.

Done when every composer of a multi-part entry name either prefixes its segments or takes ids that cannot carry the separator — and the claim over entry naming says which rule holds, without an exception the code does not mark.
