---
id: 01a14c05-71a7-71c8-88a1-ee4d46fcae8c
title: Closing the window keeps work; Quit stops an empty Tagma, Stop stops everything
ord: 20
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4cea7d76f8
sources:
  - kind: file
    ref: apps/tagma/desktop/src/leaving.ts
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
  - kind: file
    ref: apps/tagma/desktop/src/quitting.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/server.ts
---
**Value.** The user closes the window without interrupting work, and can separately stop Tagma entirely.

**How.** Closing the window, Quit in the menu or Dock, a separate Stop Tagma; from the terminal — `tagma quit`.

**Behaviour.** On macOS, closing the last window leaves the app and server alive. Quit stops its own server only when there are no agents, terminals, commands, call recording, installation or transfer running; while working or with unknown state it only closes the app. Stop first enumerates the consequences and then ends the server and the execution host with everything it runs. A window aimed explicitly at another surface does not stop the server.

**Limits.** The `quit` CLI is not a soft close of the window alone: it ends work entirely and reports a forced takedown if the server did not leave. A system logout does not hold the window with a question. The `serve` help still claims no CLI verb ends the server, although `quit` does.
