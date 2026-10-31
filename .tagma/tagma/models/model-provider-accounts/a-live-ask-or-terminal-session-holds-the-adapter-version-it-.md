---
id: 01a18e37-1c6d-78dd-8bd3-2a1bf928125d
title: A live ask or terminal session holds the adapter version it runs from, and only an unheld old version is deleted
ord: 28
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18cbf-97fc-7f17-bc60-685157787448
  - kind: relates
    to: 01a18de6-f105-7aa9-9e69-70e8074b1336
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cli/installedHarness.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/adapters.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/store/packages.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/installs.ts
---
A version directory keeps the files a running process still reads after the registry moved on: a program ask may run a script its package ships, and the hook process of a CLI imports its codec from the package on every event. Deleting the directory under such a process breaks the ask, or leaves a running turn without its stop hook, so its CLI never reaches rest and is never retired.

- **What holds a version.** The current install; a package the current catalog, a pinned run's catalog (`ProviderRegistry.pinned`) or a current harness row (`PackageHolders.standing`) routes to; a lease (`AdapterInstalls.hold`); and a live terminal session that recorded the version in its facet (`session.package`, read through `PackageHolders.recorded`, so a restarted server's boot sweep still sees it).
- **Leases.** An ask leases its route's package before anything else and keeps it until its answer is read; a launch leases its row's package from row resolution until its session facet records it (`hold(…, recorded)`), and that lease keeps protecting until a collection that started after its release has read the sessions. A lease is taken only while the directory still exists; an ask or launch whose version was already retired resolves its route or row again from what is current.
- **Collection** runs at boot and after each install, update and removal, and when the last ask lease of a version that is no longer current ends. It decides and renames every deleted directory away in one synchronous step against the live leases, so a lease is either seen or finds its directory gone; the renamed directories are removed afterwards.
- **Reading a running CLI.** Its hook process loads the codec from `TAGMA_ADAPTER_PACKAGE`, and every server reader of the session — hook reports, watch, screen asks, metadata, interrupts, roots, alignment — takes the row of that same version (`HarnessAdapters.running`/`runningRow`), so an update that renames an event or a removal never switches a running CLI to another reading. A server started after the version was replaced or removed loads the rows of every version a live session recorded before it serves (`ProviderRegistry.loadVersion`, `serving.ts`), because the directory those sessions hold is still on disk. A recorded version whose rows could not be loaded reads as not installed, never with another version's row; only a session that recorded no version reads with its harness's last row.
