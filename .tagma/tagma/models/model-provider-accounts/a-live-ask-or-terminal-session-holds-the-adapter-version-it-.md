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
    ref: apps/tagma/server/src/providers/adapters/installs.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/store/packages.ts
  - kind: file
    ref: apps/tagma/server/src/composition/cli/installedHarness.ts
---
A version directory keeps the files a running process still reads after the registry moved on: a program ask may run a script its package ships, and the hook process of a CLI imports its codec from the package on every event. Deleting the directory under such a process breaks the ask, or leaves a running turn without its stop hook, so its CLI never reaches rest and is never retired.

- **An ask** holds the package its route names (`AskRoute.package`) for the length of the program run and its answer, in memory (`AdapterInstalls.hold`). An ask whose run started on the earlier catalog therefore finishes on the earlier version; the next ask resolves the current one.
- **A terminal session** launched from an installed harness records the version directory in its session facet (`session.package`) and in its CLI's environment (`TAGMA_ADAPTER_PACKAGE`). The hook process loads the named harness from that directory while it exists, and from the registry's index route otherwise, so an update or removal never switches a running CLI to another codec. The hold is read from the standing sessions (`PackageHolders`) rather than kept in memory, so the boot sweep of a restarted server still sees it while the CLI keeps running on the execution host.
- **Collection** deletes every version directory that is neither current nor held, at boot and after each install, update and removal; the end of the last ask holding a directory deletes that directory then. A directory a session held stays until the next collection after the session ends.
