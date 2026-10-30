---
id: 01a18de6-f105-7aa9-9e69-70e8074b1336
title: A live process of a removed harness ends once its thread is at rest, by the act its transport already ends idle processes with
ord: 200
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16b6c-5c3e-7e18-87c5-60ff8711a398
  - kind: relates
    to: 01a18cbf-97fc-7f17-bc60-685157787448
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/retirement.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/process.ts
---
Removing or disabling an adapter package withdraws its harness at once, but a CLI already running for one of its threads is not killed: it is ended once that thread is at rest, by the act each transport already uses to end a process between turns. Every change of the adapter rows (`HarnessAdapters.changes`) looks again, so a package installed back before the thread rests keeps its process.

- **ACP.** A link whose harness has no installed row counts as stale, like a runner of another Tagma build: it gets no new prompt, and at rest `ProtocolProcess.retire` releases it with the idle-hour act, so the session ends `completed`. Words still waiting relaunch it, and that launch refuses `harness-not-installed`, ending the session with that reason. An idle session no link holds is handed back to its watcher, which attends a stale process at once.
- **The last row.** Driving a live ACP process needs its adapter row even after removal, so `HarnessAdapters.last` answers the row it holds or the last one it held for that id, and linking reads it. A launch resolves through `row`, never `last`: a new process of a removed harness still refuses. A server started after the removal knows no row for that harness, and nothing it runs can read the process. So `drive` halts a held process at once and ends its session `failed` with the `harness-not-installed` reason, rather than leaving it uncertain and running forever.
- **Terminal.** At rest means what the idle stop already means — the session is `running` and the CLI has no open turn (`facet.turn`). `sessions/retirement.ts` waits for that on the session facet and stops the CLI with `SessionDriver.stop(…, idle)`.
