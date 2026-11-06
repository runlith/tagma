---
id: 01a12320-6de7-77c2-925c-9f3a38074044
title: "A plugin's process opens on demand and changes only under the plugin's lock: calls wait through every transition and a crash's backoff gate instead of reaching the old process"
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
  - kind: supersedes
    to: 01a1882b-4844-74c8-9ecd-8e2943d5f5c4
sources:
  - kind: file
    ref: apps/tagma/server/src/plugin-host/generation.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/supervisor.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/listing.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/digests.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/points.ts
---
Two live processes of one plugin would both write into its data and answer different agents. So every change of a plugin's process — opening it on demand, stopping it when quiet, replacing it after a rebuild or an option change, recovering from a crash, stopping it when no project enables it — runs under that plugin's lock and uninterruptibly, and while it runs every new call waits for it to end and then serves on what stands.

The declaration stands apart from the process. Reading the plugin and checking its contributions against the points comes first. A refusal there — the manifest no longer reads, a contribution fails its point — keeps what stands, contributions and process alike, and the row's `process.refused` names it; a passing cause (files or the key store not answering) is read again every 5 s, and with backoff while nothing stands. A new declaration — the content of the build's outputs or the launch environment changed — then waits for started calls, at most 10 s; closes the old session's `Scope`, which waits for the process group to exit; replaces the old contributions with the new ones; and opens a process at once only for a `resident` plugin. A new declaration that leaves the process as it was — the entry module's content (`processRevision`), the launch environment, the process declaration and the tools all unchanged — only replaces the contributions, and the running generation stays. A replacement is one `PluginPoints.publish` handed the old publication's withdrawal. It withdraws first, so a declared point never sees two publications of one plugin. A point read through `PluginPoints.hold` keeps the old contribution until the new one takes its place, and tells its listeners once, at the end. So a feed never reads a republished plugin as absent, and a view never remounts for it. A publication a point refuses leaves the plugin `failed` with nothing standing; it waits for its own next change.

The host takes a plugin up when some project first enables it and stops it when none does; any other change of the enabling only updates the projects its calls carry. A plugin is read again only for a change of its own — its outputs (the watcher), its options or secret values, a new install of it — so another plugin's enabling never re-reads it, nor cuts short its backoff. Uninstalling drops the record, then stops the process through `PluginProcesses`, waiting out its calls, and removes an installed copy only after that, so a running process never loses its files.

A non-resident plugin stands `idle`: its contributions are published and no process runs. Any demand that goes through the supervisor — a tool call from an agent or a view, a resource read or subscription, a tick, an ending, a notification answer, a build step — opens a generation under the lock. A generation whose `tools/list` differs from the manifest's `tools` in names, descriptions, input schemas or annotations is closed and the plugin reads `failed` with the difference named: the catalog agents see was published from the manifest, so a differing process would serve tools nobody was shown. Only new outputs open it again, since an unchanged build would differ the same way. While a plugin is `failed` its agent and own tools are withdrawn from agents' catalogs; its other contributions stay. A generation with no call in flight and no open subscription for the quiet period (`HostPlace.quiet`, five minutes in the product) is stopped by the same transition and the plugin is `idle` again.

A crash closes the generation at once and arms a backoff gate, 1 s doubling to 60 s, reset when the process lived 30 s and by any new declaration. A process that does not spawn or ends before it answers `initialize` is a crash too: the cause is the machine's or passing, and no file edit is owed. A demand before the gate waits for it, so a tick runs and an ending or answer is delivered once the gate opens. The demands waiting on one gate share its one open: when it fails, each fails its caller with the reason instead of opening again, so a crash's backoff doubles once per gate and not once per waiting demand. After a crash a non-resident plugin is `idle` with its tools still offered, so an agent's call is the demand that opens it; a resident one reads `failed` and the supervisor reopens it when the gate opens. The resident retry is planned through a separate fiber under the lock: replacing the `FiberMap` record waits for the current pass to end, otherwise its interruption would break the next generation's connection.

The launch environment is the plugin's options that have a value, each under its key; secret ones come from the key store and go to the session redactor (`mcpRedactor` covers tool answers, reads and resource subscriptions, launch refusals and the stderr tail). The host's `TAGMA_*` variables come after the options, and no option may name one. Every call and resource request carries the projects where the plugin is enabled in `_meta["runlith/projects"]`, the projects a tick's handler may act in.

Closing waits for the whole process group to exit, not just the direct child: `@runlith/mcp` starts the stdio server as the leader of its own group and finishes the group off, so nothing the entry module spawned outlives the close and writes beside the next process.

The revision is the content of the build's outputs — the manifest and the entry module — judged first by size and modification time and hashed in `plugins`' digest worker only when those moved. A stamp is kept only once every file's time is at least two seconds older than the reading. A file system with coarse timestamps can give two same-sized writes within one tick the same time, so a stamp read that close to a write is not trusted, and the next reading hashes again. `dist/ui/` is not among them, and a rebuild that rewrites identical bytes changes nothing. A rebuild that changes only views rewrites the manifest, whose build hash covers the view sources, so it is a new declaration, but its `processRevision` stands, so it never restarts the process. The watcher stands under the lock and wakes a re-read only for those outputs, or for any path outside `node_modules` and `.git` while the plugin has never been read; when it is lost or fails to open, it reopens and the plugin is read again every 5 s until it stands.
