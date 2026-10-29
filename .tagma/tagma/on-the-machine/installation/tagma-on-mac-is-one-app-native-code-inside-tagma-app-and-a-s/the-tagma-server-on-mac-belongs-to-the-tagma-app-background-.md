---
id: 01a1047e-ddf0-7edd-b8da-e66f58e9f787
title: "The Tagma server on Mac belongs to the Tagma.app background agent: start at login, restart through launchd, rollback to the risen version"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/server.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
Right now the first client to call raises the server — `tagma serve`, `tagma web`, or the window (`installation/cli/server.ts`, `apps/tagma/desktop/src/SurfaceLoader.ts`). Restart works like this: the old server spawns a detached successor and leaves once it stands (`installation/process/succession.ts`). Such a server has no owner: after system login it never rises by itself, after a crash nobody restarts it, and in macOS its process belongs to whoever once launched it. This stage hands the server to the `Tagma.app` background agent — on a Mac where the app is installed and the agent is on.

## The app at a permanent path

The agent registers out of the bundle and points at a program inside it, so `Tagma.app` must live at a path that never changes between builds.

- **The development channel** installs the app at `~/Applications/Tagma.app` (`Tagma Dev.app` gets its own next to it). The checkout build does that, and only when what the app is built from changed: desktop sources, native helpers, the Electron version. Compared by these inputs' fingerprint. The rest — bun, the server, the interface — still installs into `~/.tagma/install/<version>` and switches through `current`. The build never puts it inside the signed app ([[0c6f5fab|signing]] seals the bundle).
- **The running window is untouched.** The new app takes effect from the window's next launch; the build says so in its summary.
- **The release** puts everything inside the app ([[3de8a8fa|release]]).

## Agent

- **Registration.** Electron main registers the agent at launch through `app.setLoginItemSettings` with the agent service type (SMAppService). The plist lies in `Contents/Library/LaunchAgents`. The Label is unique per channel and never changes across updates: in the experiment two apps with one Label launched someone else's binary.
- **The agent program** is a small native launcher `Contents/MacOS/tagma-agent`. It finds what to launch:
  - `Contents/Resources/tagma`, when the installation lies there (release);
  - otherwise `~/.tagma/install/current` (development).

  Then it routes output into `~/.tagma/serve.log` and `exec`s into `bun … serve`. The launcher keeps no processes of its own.
- **`KeepAlive` with `SuccessfulExit = false`.** launchd raises the server after a crash, but not after a deliberate stop with code 0.
- **The agent never receives the developer environment.** `TAGMA_PORT`, `TAGMA_DATABASE_PATH` and the like do not apply to the agent's server. A server on another port or with another database is `tagma:try`; it works in standalone mode.

## One restart owner

A server under the agent knows it runs under it: an environment variable from the plist says so.

- **Restart** — after a build, from the interface, or by `tagma restart` — is `launchctl kickstart -k` of its own job. The server never spawns a successor. The `Succession` implementation for agent mode is separate; standalone mode stays as is.
- **Rolling back to the last risen version is the launcher's job.**
  - Once answering `/health`, the server marks its version as risen.
  - Before `exec` the launcher counts launch attempts of a version that never rose once. After the third failure it moves `current` to the newest risen version and launches it.
  - A broken build leaves a working Tagma and a record of what happened; the build summary in the interface shows that rollback.
  - Right now the successor handshake gives that guarantee; with the agent the rollback gives it.

## How clients raise the server

- **The agent is on.** The CLI (`ensureServer`), the window (`SurfaceLoader`) and `tagma web` ask launchd to raise the job (`launchctl kickstart`) and await `/health`. They never launch the server themselves.
- **The agent is unregistered, awaits approval, or was switched off by the user in System Settings,** and also on Linux and in an appless installation: standalone mode, as now. The window says the server does not start at login, and where to switch that on. No requests or confirmations beyond that.
- **Moving from standalone mode to under the agent is a handover.**
  - Once the agent is on, the standalone server leaves.
  - The agent's server takes the data directory while awaiting the previous holder's departure, as `standBy` already does.
  - An agent server that never got the directory exits with code 0, so launchd never spins it in circles.

## What proves it

- **launchd.** `launchctl print gui/<uid>/<label>` shows the job with the running server's pid.
- **Window.** Closing all windows and quitting `Tagma.app` never stop the server.
- **Login.** After logout and login the server rises with no window opened.
- **Crash.** `kill -9` the server — launchd raises a new one, the window and tabs reconnect.
- **Rebuild and restart from the interface.** The new version runs, exactly one `serve` process, none outside the job.
- **Broken build** (the server crashes at startup). After three attempts `current` points at the previously risen version, Tagma works, the build summary names the rollback.
- **The agent is off in settings.** Tagma runs in standalone mode, the window shows that.
- **`tagma serve` with the agent on** raises the job and spawns no server of its own.
- **A standalone server at the moment the agent is first switched on** — one server runs after the handover.
- **The launcher rollback** is verified by a test on fake version directories: attempt counting, risen-version picking, no rollback for a version that once rose.
