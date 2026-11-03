---
id: 01a1048f-5f61-7547-a886-c4732e073431
title: "The Tagma server under launchd supervision: start at login and restart on crash — and which current guarantees that breaks"
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1047e-ddf0-7edd-b8da-e66f58e9f787
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/boot.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
Right now the first client that needs the Tagma server raises it, and the server restarts itself by handing the place to its successor (`installation/process/succession.ts`). At system login the server never starts itself, and after a crash nobody restarts it. Handing it to the `Tagma.app` background agent (SMAppService) is technically possible even without a Developer ID ([[c3dad364|the TCC study]]). macOS permissions do not need it: the signature and the helper inside the app grant them. The decision is postponed because launchd supervision breaks several current guarantees. Each one needs solving separately:

- **Live terminals and commands.** After a job dies launchd kills its group's remaining processes, while the execution host currently launches without `detached` (`executions/host/boot.ts:216`). A plain server restart would sever terminals, yet `cli/server.ts` promises they survive a restart without `--force`.
- **Restart.** `launchctl kickstart -k` kills the process and never lets it answer the restart request and close the stores. The standard road is an orderly exit with a nonzero code under `KeepAlive.SuccessfulExit = false`.
- **Rolling back to the previous version** by switching `current` fails after a migration: the old version refuses to open a database with a migration it does not know (`platform/store/chain.ts`). The attempt returns the data only for a start before its door, and its start counter before `exec` never tells a crash from a deliberate stop or a hang.
- **Environment.** Under launchd there is no user `PATH`, and the server stops finding Claude Code, Codex and Homebrew tools (`external-harnesses/birth/installed.ts`).
- **Modes and channels.**
  - `tagma:try` and child CLIs inherit the agent-mode mark from the environment.
  - Two Labels (`Tagma.app` and `Tagma Dev.app`) lead to one database and port.
  - The dev window (`desktop/scripts/dev.ts`) would start evicting the server the dev-runner raised.
  - Someone must initiate the handover from standalone mode to under an agent.
- **App location.** The agent needs the permanent `Tagma.app` path, while the CLI, the installation check and the manifest currently look for the desktop inside each installation version.

When only "Tagma at system login" is needed, the cheap alternative is a login item for the app itself (`openAtLogin`): the window raises the server as now, and no launchd supervision is needed.
