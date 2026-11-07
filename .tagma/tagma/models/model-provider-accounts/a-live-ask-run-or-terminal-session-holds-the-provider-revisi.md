---
id: 01a18e37-1c6d-78dd-8bd3-2a1bf928125d
title: A live ask, run or terminal session holds the provider revision it runs from, and only an unheld revision is deleted
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
    ref: apps/tagma/server/src/plugins/revisions.ts
---
A revision directory keeps the files a running process still reads after the catalogs moved on: a program ask may run a script its part ships, and the hook process of a CLI imports its codec from the part on every event. Deleting the directory under such a process breaks the ask, or leaves a running turn without its stop hook, so its CLI never reaches rest and is never retired.

- **What holds a revision.** The current revision of an installed plugin; a lease (`PluginRevisions.hold`); every revision a holder registered with `PluginRevisions.register` names — the registry's current and pinned catalogs (`ProviderRegistry.pinned`), the harness owner's current rows; and the revisions live terminal sessions recorded in their facet (`session.package`), read at each collection through `RevisionRecords`. The plugins layer takes that port at construction, so the collection at start, which runs before any holder could register, still sees what a restarted server's sessions hold.
- **Leases.** An ask leases its route's revision before anything else and keeps it until its answer is read; a launch leases its row's revision from row resolution until its session facet records it (`hold(…, recorded)`), and that lease keeps protecting until a collection that started after its release has read the sessions. A lease is taken only while the directory still exists; an ask or launch whose revision was already retired resolves its route or row again from what is current.
- **Collection** runs at start, after each change of the provider parts (an install, update or uninstall, a new revision, the machine switch), when a holder reports it let a revision go (`PluginRevisions.released`: the registry after each reload, and when a pinned run whose revisions nothing else holds settles), and when the last lease of a revision nothing else keeps ends. It decides and renames every deleted directory away in one synchronous step against the live leases, so a lease is either seen or finds its directory gone; the renamed directories are removed afterwards. Staging left by a crash is removed at start.
- **Reading a running CLI.** Its hook process loads the codec from `TAGMA_ADAPTER_PACKAGE`, the revision directory, and every server reader of the session — hook reports, watch, screen asks, metadata, interrupts, roots, alignment — takes the row of that same revision (`HarnessAdapters.running`/`runningRow`), so an update that renames an event or an uninstall never switches a running CLI to another reading. A server started after the revision was replaced loads the rows of every revision a live session recorded before it serves (`ProviderRegistry.loadVersion`, `serving.ts`), because the directory those sessions hold is still on disk. A recorded revision whose rows could not be loaded reads as not installed, never with another revision's row; only a session that recorded no revision reads with its harness's last row.
