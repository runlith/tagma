---
id: 01a19480-07fa-7a6e-848d-5ad5b6664353
title: The client wire speaks only the catalog entries the root contributes, typed by the Operations and Feeds interfaces the root fills
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a193d9-9a1f-79e8-9f71-7a9ff0c456d5
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/WireCatalog.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/operation.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/liveGroup.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/release/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/composition/developer/catalog.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/composition.ts
---
A module's wire module is its catalog entry: its lazy `operations` and its `feeds`. The client speaks no other list. `Door` takes its codecs and `Live` takes its RPC group from the `WireCatalog` point. The root fills that point, and beside that contribution it augments the `Operations` and `Feeds` interfaces, as an app fills `Ladder`. The core does both in `lib/app/composition.ts`: in a declaration file, the dead-code inspection would not count the augmentation as a consumer. The core root contributes `CATALOG_MODULES` from `@tagma/server/composition/catalog`. That entry resolves by the build's package conditions: the developer catalog by default, the release catalog under `release`. So a release app carries no developer-only entry. Another root contributes its own entries beside the core's and widens both interfaces. Nothing checks at compile time that the root's values and its types agree. A type with no contributed entry compiles, but its operation is refused unsent (`OperationUndeclared`), and its feed never reaches the group.

Codecs stay lazy: the first `perform` loads every entry's `operations()`, and the next load comes only when the point's items change. A failed load is not kept, so the next call retries. The live group is derived from the items when a connection opens. An entry that joins later reaches the next request and the next connection. A socket that is already open keeps the group it opened with.

On the server, a wire module's `feeds` spread into its manifest. At boot, `checkManifests` refuses `LiveFeedsUnmatched` when the module's `live` serves other feeds than its wire module declares. `composition/liveGroup.test.ts` compares the developer catalog's group with the served group.
