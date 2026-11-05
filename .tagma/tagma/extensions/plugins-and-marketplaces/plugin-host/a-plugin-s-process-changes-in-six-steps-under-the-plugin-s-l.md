---
id: 01a12320-6de7-77c2-925c-9f3a38074044
title: A plugin's process changes in six steps under the plugin's lock, and calls wait for the new process instead of reaching the old one
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
    ref: apps/tagma/server/src/plugin-host/revision.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/supervisor.ts
---
Two live processes of one plugin would both write into its data and answer different agents. So everything that changes a plugin's process — start, restart on an edit of its files or options, recovery after a crash, stop — runs under that plugin's lock, and the restart body is uninterruptible.

Order: read the plugin and check its contributions against the points → close accepting calls (new calls wait until the next process comes up) → wait for started calls, at most 10 s → close the old session's `Scope`, which waits for the child process to exit → open a new one → withdraw the old contributions and publish the new ones. A refusal before the old one closes (the manifest no longer reads, or a contribution fails its point) keeps it working, and the row's `process.refused` names it. A failure after it is `failed`. A tool the manifest named but the new process did not hand over lands there too: it is only learned from the running process.

The launch environment is the plugin's options that have a value, each under its key; secret ones come from the key store and go to the session redactor (`mcpRedactor` covers tool answers, reads and resource subscriptions, launch refusals and the stderr tail). The variables' fingerprint joins the generation comparison beside the file revision: a changed option or secret restarts the process with the same six steps without touching the revision. A plugin that cannot be read for a passing cause — its files or the key store not answering — does not start without its options: a working process stays and shows `refused`, one without a generation stays `failed`. Unlike a declaration refusal, such a refusal repeats itself: with backoff when there is no process, every 5 s while one works. The host's `TAGMA_*` variables come after the options, and no option may name one.

Closing waits for the whole process group to exit, not just the direct child: `@runlith/mcp` starts the stdio server as the leader of its own group and finishes the group off. Otherwise a grandchild behind an `npm` or `sh` wrapper would outlive the close and write beside the new process.

A crashed process immediately loses its contributions, its `Scope` closes, and it comes back up with backoff from 1 to 60 s; the counter resets when the process lived 30 s. A call during backoff refuses at once (`McpNotConnected`); only calls during a restart wait for the new process. A declaration refusal does not repeat itself: it waits for the next file edit. The retry is planned through a separate fiber under the plugin's lock: replacing the `FiberMap` record waits for the current pass to end, otherwise its interruption would break the next generation's connection. The watcher also stands under the lock. When it is lost or fails to open (error, tickets ran out, no directory), it reopens and the revision is re-read every 5 s until the watcher stands.

The revision is a hash of the plugin's code files' paths, sizes and mtimes. It excludes top-level `ui/`, `node_modules` and `.git` at any depth, and what the plugin's own `.gitignore` names. Otherwise a process writing a log or a database beside itself would restart itself in a loop. Editing views does not restart the process. Watcher events on such paths do not wake re-reading, and file contents are not read on events.
