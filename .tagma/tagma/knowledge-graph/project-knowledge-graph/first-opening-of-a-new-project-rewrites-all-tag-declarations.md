---
id: 01a13fe1-0a0a-7f73-95af-a00b5c5a6e97
title: "First opening of a new project rewrites all tag declarations: install at birth omits identity.shipped, the repeat plan adds it"
ord: 52
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13fd0-aafb-7c4c-bb78-cce3611ba91a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13fcf-78eb-70b7-b325-3b15ec522548
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/candidate.ts
---
**What.** Installing catalogs at project birth (`installCatalogs` in `ProjectLifecycle.create`, `graph/serving/birth.ts`) writes tag declarations without `identity.shipped`, and the first graph opening (`ensureVocabulary('mirror')` in `graph/serving/open.ts`) plans the same install again and rewrites all ten `#tag` declarations, adding `identity: { shipped: { library, export } }`. Hence an extra act and an extra tree commit (`update … +4`) in every new project.

**Measured (door fixture, one plain-project registration, one sample).** After the commit `the serving switch` the tree gets an `update c929… · … +4` commit: 10 `tags/*.md` files, 6 `identity.shipped` rows each. Its `TreeCommitter.publish` holds the repository permit for 56–65 ms, and the first opening's `FreshnessGate.refresh` waits 57 ms for it. The same shows in `mirrorMove.itest.ts` (`SHIPPED_CATALOGS` fixture).

**Where to look.** The plan is not idempotent: `settleCatalog` in `graph/vocabulary/candidate.ts:256` gives a new type (`row === undefined`, not `held`) a null identity; on the next plan `copyOf` (`candidate.ts:157-171`) finds the row by `declaration.id`, `table.identities.typeOf(...).shipped` is no longer null, the type becomes `held`, and `identity.shipped` is written on the second pass. Confirm the cause against the code; nearby stands the provenance record for verified rows (`candidate.ts:455-466`).

**Done when.** A repeat plan over just-installed catalogs writes nothing: after project registration the tree has no commit rewriting declarations; the `read_tags` answer is unchanged.
