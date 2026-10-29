---
id: 01a14c05-71a7-71c8-88a1-ee4aba458262
title: Window and CLI raise the local server on call; the same server opens in the browser
ord: 17
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee546656e4ff
sources:
  - kind: file
    ref: apps/tagma/desktop/src/server.ts
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/composition/cli/serve.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/clients.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/server.ts
---
**Value.** One Tagma is available as window, browser and CLI without hand-starting a separate background server.

**How.** Opening the app, `tagma web`, `tagma desktop`; `tagma serve` starts the server in the current terminal. Address and separate data are set by the launch environment.

**Behaviour.** The first local client raises the missing server and waits for the result; an answering server is used without replacement just because the CLI build differs. The variant with no client opened raises the server and prints the address. One data directory holds one process; with simultaneous local touches the losing start waits for the winner's answer. Another server needs its own data. The window checks that the answering server belongs to its data.

**Limits.** This is launch on demand, not a login autostart service. A client aimed at someone else's machine or an explicitly named surface does not start a server there. The `web` help still describes time-bounded waiting, although the current code waits for the recorded answer, refusal or process exit; the `desktop` help still says Finder waits for the server, although the window raises it itself.
