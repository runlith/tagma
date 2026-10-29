---
id: 01a12320-6de7-77c2-925c-9f3a38074044
title: Plugin process changes in six steps under the plugin lock, and calls wait for the new process instead of reaching the old one
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/generation.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/revision.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/supervisor.ts
---
Two live processes of one plugin are two dealers at one table: both write into their own data and answer different agents. So everything that changes a plugin's process — start, restart on edit, recovery after a crash, stop — runs under that plugin's lock, and the restart body is uninterruptible.

Order: read and check `plugin.json` and points → close accepting calls (new calls wait until the next process comes up) → wait for started calls, at most 10 s → close the old session's `Scope`, which waits for the child process to exit → open a new one → remove old contributions and register new ones. A refusal before the old one closes (`plugin.json` or a point fails checking) keeps it working, and the row shows `refused`. A failure after it is `failed`. A tool the manifest named but the new process did not hand over lands here too: it is only learned from the running process.

The launch environment is assembled by providers owners register through `PluginLaunches.provide`: each gets the plugin id and the checked manifest contributions and returns env variables and values for the session redactor (`mcpRedactor` closes tool answers, reads and resource subscriptions, launch refusals, and the stderr tail). The variable fingerprint joins the generation comparison alongside the file revision: changed environment restarts the process with the same six steps, and the owner reports the change through `PluginLaunches.changed` without touching the revision. A provider that could not assemble the environment refuses the launch rather than starting the process without it: the working process stays and the row shows `refused`, a process without a generation stays `failed`. Unlike a declaration refusal, such a refusal is temporary (for example, a file outside the plugin directory could not be read), so it repeats itself: with backoff when there is no process, and every 5 s when a process works. The host's `TAGMA_*` variables come after providers' variables, and a provider does not override them.

Closing waits for the whole process group to exit, not just the direct child: `@runlith/mcp` starts the stdio server as the leader of its own group and finishes the group off. Otherwise a grandchild behind an `npm` or `sh` wrapper would outlive the close and write beside the new process.

A crashed process immediately loses its contributions, its `Scope` closes, and it comes back up with backoff from 1 to 60 s; the counter resets when the process lived 30 s. A call during backoff refuses at once (`McpNotConnected`); only calls during a restart wait for the new process. A declaration refusal does not repeat itself: it waits for the next file edit. The retry is planned through a separate fiber under the plugin lock: replacing the `FiberMap` record waits for the current pass to end, otherwise its interruption would break the next generation's connection. The watcher also stands under the lock. When it is lost or fails to open (error, tickets ran out, no directory), it reopens and the revision is re-read every 5 s until the watcher stands.

The revision is a hash of the plugin code files' paths, sizes, and mtimes. It excludes top-level `ui/`, `node_modules` and `.git` at any depth, and what the plugin's own `.gitignore` names. Otherwise a process writing a log or a database beside itself would restart itself in a loop. Editing views does not restart the process. Watcher events on such paths do not wake re-reading, and file contents are not read on events.
