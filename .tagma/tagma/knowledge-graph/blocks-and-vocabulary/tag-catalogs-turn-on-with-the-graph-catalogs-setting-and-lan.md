---
id: 01a14bc5-0df5-77c8-b1a2-6930741af75a
title: "Tag catalogs turn on with the graph.catalogs setting and land in the project as ordinary #tag nodes"
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692f1e9ecb91
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6937cc0e28a3
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694599fa9ace
sources:
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/coreLibrary.ts
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/knowledge.ts
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/registry.ts
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/softwareDevelopment.ts
  - kind: symbol
    ref: apps/tagma/server/src/catalogs/contract/wire/settings.ts
    symbol: graphCatalogs
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/birth.ts
    symbol: ensureVocabulary
  - kind: symbol
    ref: apps/tagma/server/src/graph/vocabulary/activation.ts
    symbol: installCatalogs
---
**Value.** A ready dictionary for a kind of work turns on with one setting, and the project need not invent what records to keep from scratch.

**How.** The `graph.catalogs` setting or catalog choice in the new-project dialog. Three catalogs ship:
- `core` — system types: reflection, saved view; on by default;
- `software-development` — modules, explanations, specs, tasks, rules, ideas, research; on by default, declares the graph a graph over code;
- `knowledge` — decisions, people, meetings, and sources; an ordinary note is a block with no tag. The catalog does not depend on how the graph is stored.

**Behaviour.** An enabled catalog sets its tags as ordinary `#tag` nodes alongside the project's existing declarations; later they read and edit as their own. Moving or renaming their container preserves its use for catalog additions and updates. A project with no declarations gets a new container under its root. At graph start the server delivers new releases of the enabled catalogs. An export removed by a release leaves that catalog's membership; its declaration and existing blocks remain, and the declaration can be deleted normally. A knowledge decision stands until replacement through `supersede_block`: the core link keeps the predecessor and leads to the new decision, with no separate status field.

**Moving from notes.** When the server updates, the setting and the installed catalog get the knowledge id; the graph migration carries permanent links and the release base forward before the ordinary update. People and meeting UUIDs and keys are kept. The old note and recipe types become project declarations: their blocks, fields, and links stay, but a new project no longer gets these tags.

**Limits.** Turning a catalog off never deletes its nodes. A tag of a disabled catalog is refused, and the refusal suggests enabling the catalog. A release that cannot be applied over local edits is not installed: the earlier one stays, and a finding names the cause.
