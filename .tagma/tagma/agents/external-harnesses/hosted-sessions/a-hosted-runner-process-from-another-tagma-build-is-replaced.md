---
id: 01a16b6c-5c3e-7e18-87c5-60ff8711a398
title: A hosted-runner process from another Tagma build is replaced at rest by the same act as the idle-hour one
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16b5d-7897-74bd-9568-ce098da1f8be
  - kind: relates
    to: 01a10973-ef85-739e-8a04-c139d0810682
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/attendance.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/endings.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/process.ts
---
The runner process survives a server restart so the running turn is not cut off ([[d0810682|call break and server restart]]). Without replacement, a Tagma update would never reach a live thread until the process died on its own: the new server would reconnect the old process and hand it the next words.

- **What counts as a build.** The protocol row remembers the build of the server that started the process (`build`, from `HarnessOwner.build`: the install digest, and for a server from a checkout the owner id, so every restart counts as a new build there). Only the `drive` whose launch operation actually created the process sets the build: `ProtocolLauncher` reads the launch operation before starting, and an operation someone already took answers `Started` with the previous server's process (`fresh: false`). Executions found already running (their row was never recorded before the crash) and rows from before this build field know no build, and an unknown build counts as foreign: a spare replacement at rest costs less than an old-code process living until the idle hour.
- **Whom it covers.** Only profiles whose process is Tagma code (`hosts` not `null`: Claude Code, Cursor, OpenCode via `tagma harness-run`). The Devin process is the vendor's program; a Tagma update does not change it.
- **When.** Only at rest (`resting`): a turn started on the old process runs to its end there. A connection to a foreign-build process delivers it no new prompts or compactions (`ProtocolPrompts.prompt`). Words arriving mid-turn go as usual. Once the connection is at rest, the process is released by the same act as the idle-hour one (`ProtocolProcess.release`). If words are waiting, a process of the current build starts immediately and continues the same vendor session (`session/resume` or `load`); otherwise the session ends `completed`, and the next word raises the process. Words arriving during a clean release still go to the next drive: ending the old process does not fail a waiting launch. An idling foreign-build process reconnects right after a restart (`ProtocolAttendance.observed`) instead of waiting out the idle hour.
- **Why not `TransportResource.release`.** That path (`attendance.stop`) ends the session as `aborted` and fails a launch that is already waiting. Replacement needs waiting words to reach the new process.
