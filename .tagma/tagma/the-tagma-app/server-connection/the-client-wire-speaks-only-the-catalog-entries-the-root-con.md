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
    ref: apps/tagma/app/src/lib/app/composition.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Live.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/liveGroup.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/operation.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/WireCatalog.ts
  - kind: file
    ref: apps/tagma/server/src/composition/developer/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/composition/release/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/manifest.ts
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/service/manifest.ts
    symbol: servesDeclared
---
A module's wire module is its catalog entry: its lazy `operations` and its `feeds`. The client speaks no other list. `OperationTable` loads codecs, declarations and module ownership from the `WireCatalog` point, and `Live` derives its RPC group from the same point. `Door` encodes and decodes through the table. The thread feed's tool words and its per-module tool registrations read the table too. The root fills the point and, beside that contribution, augments the `Operations` and `Feeds` interfaces, as an app fills `Ladder`. The core does both in `lib/app/composition.ts`: in a declaration file, the dead-code inspection would not count the augmentation as a consumer. Another root contributes its own entries beside the core's and widens both interfaces through `@tagma/app/wire/operations` and `@tagma/app/wire/feeds`. Nothing checks at compile time that the root's values and its types agree. An operation whose type has no contributed entry compiles, but it is refused unsent (`OperationUndeclared`). A feed in the same position never reaches the group.

The core root contributes `CATALOG_MODULES` from `@tagma/server/composition/catalog`. That entry resolves by the build's package conditions: the developer catalog by default, the release catalog under `release`. So a release app carries no developer-only entry.

The point refuses two entries that declare one feed id (`claims`). `RpcGroup.make` would otherwise keep the later rpc silently. Operation ids load lazily, so the point cannot judge them at admission: two entries that declare one operation id fail the first load, and with it the first `perform`.

The table stays lazy. The first `perform`, or the first reader of tool words or ownership, loads every entry's `operations()`. The next load comes only when the point's items change and a `perform` runs. A load answers the items standing when it lands: one whose items moved while it ran loads again. The window wakes the keys of conditions that hold before the unconditional ones, so a service under such a condition can `perform` while its build runs, before the core entry joined; without this its first call was refused `OperationUndeclared` over an empty table. A failed load is not kept, so the next call retries. Readers re-render when a load lands, and until the next load they read the table the last one produced. The live group is derived from the items when a connection opens. A connection that `separate` makes shares its parent's derived group. An entry that joins later reaches the next request and the next connection. A socket that is already open keeps the group it opened with.

On the server, a wire module's `feeds` spread into its manifest. At boot, `checkManifests` refuses `LiveFeedsUnmatched` for any manifest whose `live` serves other feeds than its wire module declares, including one that serves feeds and declares none. `composition/liveGroup.test.ts` compares each build's catalog with the feeds that build's modules serve, developer and release alike.
