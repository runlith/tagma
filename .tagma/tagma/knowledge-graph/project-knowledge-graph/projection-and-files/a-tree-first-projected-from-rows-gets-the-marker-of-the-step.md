---
id: 01a14040-627b-70a3-bf17-c83062019ddb
title: A tree first projected from rows gets the marker of the step where rows are known; without that knowledge it runs all graph steps
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/birth.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: switchIfDue
---
Project rows in the machine store are not brought forward by graph steps. Boot updates their vocabulary only at a `rows-step:<id>` mark equal to the current `GraphSteps.last`: without it, with an older or unknown one, the installer could install a new catalog before translating its old types. This also covers the existing global root. Switch writes the `format.json` marker only where the rows step is known; a tree without a marker runs absorb, steps, projection, and index on first opening, then the mirror installer. A newer step keeps the graph readable without install and write.

The rows step is known by whoever creates them with current code:
- `ProjectLifecycle.create` and `ensureGlobal` store the latest step (`GraphSteps.last`) in `meta` under `rows-step:<id>` in the same transaction that creates the rows; the lazy switch reads it from there;
- `add_project` may open the graph at once through `ServedGraphs.birth`, passing the same latest step explicitly.

The same knowledge covers mirror steps (`mirror: true`): the switch writes `graph-step:<id>` for every mirror step at or before the rows step into the fresh mirror, in the transaction that moves the rows, and a virgin birth writes all of them. Without that every born mirror re-ran its mirror steps at its first opening — a full projection, an index pass and a shadow commit at each `add_project` — though rows written by current code already stand in their form.

Retire removes the key together with `switch-started`. If the server was updated between birth and first opening and new steps appeared, the stored step is below the latest, and only the steps after it run.
